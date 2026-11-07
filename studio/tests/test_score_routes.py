import io
import zipfile
from pathlib import Path

import mido
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from muscriptor.utils.sheets import MuseScoreNotFoundError
from studio.app import create_studio_app
from studio.models import SwitchableModel, make_exporter
from studio.tests.test_app import wav_bytes

GRID = {"bpm": 120, "beats_per_bar": 4, "first_downbeat": 0, "onset_delay": 0.0, "steady": True}
NOTES = [{"instrument": "acoustic_piano", "pitch": 60, "start": 0.0, "end": 1.0}]


@pytest.fixture(scope="module")
def exporter():
    return make_exporter()


@pytest.fixture
def client(tmp_path, exporter):
    holder = SwitchableModel(
        loader=lambda s, d: None, free=lambda: None, exporter=exporter, weights={}
    )
    return TestClient(create_studio_app(holder, data_dir=tmp_path, tagger=None))


def body(**extra):
    return {"notes": NOTES, "beat_grid": GRID, **extra}


class TestMusicXml:
    def test_returns_the_file_and_passes_the_choices_on(self, client, monkeypatch):
        seen = {}

        def fake(midi, out, quantized, key, chords):
            seen.update(midi=midi, quantized=quantized, key=key, chords=chords)
            Path(out).write_text("<score/>")

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        r = client.post(
            "/studio/api/score/musicxml",
            json=body(key={"tonic": 3, "mode": "major"}, chords=False),
        )
        assert r.status_code == 200
        assert r.text == "<score/>"
        assert seen["midi"][:4] == b"MThd"
        assert seen["quantized"] is True
        assert seen["key"].label == "E♭ major"
        assert seen["chords"] is False

    def test_without_a_grid_nothing_is_quantized(self, client, monkeypatch):
        seen = {}

        def fake(midi, out, quantized, key, chords):
            seen["quantized"] = quantized
            Path(out).write_text("<score/>")

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        assert client.post("/studio/api/score/musicxml", json={"notes": NOTES}).status_code == 200
        assert seen["quantized"] is False

    def test_a_wrong_key_is_refused(self, client):
        r = client.post("/studio/api/score/musicxml", json=body(key={"tonic": 12, "mode": "major"}))
        assert r.status_code == 422

    def test_no_musescore_is_explained(self, client, monkeypatch):
        def fake(*args):
            raise MuseScoreNotFoundError("MuseScore was not found.")

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        r = client.post("/studio/api/score/musicxml", json=body())
        assert r.status_code == 503
        assert "MuseScore" in r.json()["detail"]


class TestQuantizing:
    def starts(self, midi: bytes) -> list[int]:
        parsed = mido.MidiFile(file=io.BytesIO(midi))
        found = []
        for track in parsed.tracks:
            tick = 0
            for message in track:
                tick += message.time
                if message.type == "note_on" and message.velocity:
                    found.append(tick)
        return found

    def midi_for(self, client, monkeypatch, grid):
        seen = {}

        def fake(midi, out, quantized, key, chords):
            seen["midi"] = midi
            Path(out).write_text("<score/>")

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        notes = [{"instrument": "acoustic_piano", "pitch": 60, "start": 0.53, "end": 1.0}]
        request = {"notes": notes, "beat_grid": grid, "options": {"quantize": False, "bpm": None}}
        assert client.post("/studio/api/score/musicxml", json=request).status_code == 200
        return seen["midi"]

    def test_sheet_music_quantizes_even_if_the_panel_box_is_off(self, client, monkeypatch):
        midi = self.midi_for(client, monkeypatch, {**GRID, "beat_subdivision": 4})
        assert all(tick % 120 == 0 for tick in self.starts(midi))

    def test_with_no_measured_subdivision_it_uses_sixteenths(self, client, monkeypatch):
        midi = self.midi_for(client, monkeypatch, {**GRID, "beat_subdivision": None})
        assert all(tick % 120 == 0 for tick in self.starts(midi))


class TestPdf:
    def test_returns_a_zip_of_everything(self, client, monkeypatch):
        seen = {}

        def fake(midi, folder, quantized, key, chords, page):
            seen["page"] = page
            paths = [folder / "score.mid", folder / "full_score.pdf"]
            for path in paths:
                path.write_bytes(b"x")
            return paths

        monkeypatch.setattr("studio.app.write_score", fake)
        r = client.post("/studio/api/score/pdf", json=body(page="a4"))
        assert r.status_code == 200
        assert seen["page"] == "a4"
        assert zipfile.ZipFile(io.BytesIO(r.content)).namelist() == ["score.mid", "full_score.pdf"]

    def test_an_unknown_page_is_refused(self, client):
        assert client.post("/studio/api/score/pdf", json=body(page="a3")).status_code == 422


class TestAudioRange:
    def project(self, client):
        return client.post("/studio/api/projects", files={"file": ("a.wav", wav_bytes())}).json()["id"]

    def test_cuts_the_range(self, client):
        pid = self.project(client)
        r = client.get(f"/studio/api/projects/{pid}/audio-range", params={"start": 0.02, "end": 0.07})
        assert r.status_code == 200
        data, rate = sf.read(io.BytesIO(r.content))
        assert rate == 16000
        assert len(data) == 800

    def test_refuses_a_backwards_range(self, client):
        pid = self.project(client)
        r = client.get(f"/studio/api/projects/{pid}/audio-range", params={"start": 2, "end": 1})
        assert r.status_code == 400

    def test_unknown_project(self, client):
        r = client.get(f"/studio/api/projects/{'0' * 32}/audio-range", params={"start": 0, "end": 1})
        assert r.status_code == 404


def measures_xml(count, beats=4):
    """A one-part MusicXML file of `count` empty measures."""
    bars = "".join(
        f'<measure number="{i + 1}">'
        + (f"<attributes><divisions>1</divisions><time><beats>{beats}</beats><beat-type>4</beat-type></time></attributes>" if i == 0 else "")
        + f"<note><rest/><duration>{beats}</duration></note></measure>"
        for i in range(count)
    )
    return f'<score-partwise><part-list/><part id="P1">{bars}</part></score-partwise>'


class TestView:
    def view(self, client, monkeypatch, json, count=3, beats=4):
        def fake(midi, out, quantized, key, chords):
            Path(out).write_text(measures_xml(count, beats))
            return {"key": "C major", "chords": 2}

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        r = client.post("/studio/api/score/view", json=json)
        assert r.status_code == 200, r.text
        return r.json()

    def test_measures_follow_a_steady_grid(self, client, monkeypatch):
        got = self.view(client, monkeypatch, body())
        assert got["measures"] == [0, 2, 4]
        assert got["end"] == 6
        assert got["musicxml"].startswith("<score-partwise>")
        assert (got["key"], got["chords"]) == ("C major", 2)

    def test_a_chosen_meter_changes_the_measure_length(self, client, monkeypatch):
        got = self.view(client, monkeypatch, body(options={"beats_per_bar": 3}), beats=3)
        assert got["measures"] == [0, 1.5, 3]

    def test_times_are_transport_times(self, client, monkeypatch):
        # A note stored at 0.1 s, with an onset delay of 0.1 s, plays at 0 on the
        # transport. The recording starts 0.1 s before that downbeat, so a lead-in
        # bar comes first.
        grid = {**GRID, "onset_delay": 0.1}
        notes = [{**NOTES[0], "start": 0.1, "end": 1.1}]
        got = self.view(client, monkeypatch, {"notes": notes, "beat_grid": grid})
        assert got["measures"] == [-2, 0, 2]

    def test_music_before_the_first_downbeat_gets_a_bar_of_its_own(self, client, monkeypatch):
        grid = {**GRID, "first_downbeat": 0.5}
        got = self.view(client, monkeypatch, {"notes": NOTES, "beat_grid": grid})
        assert got["measures"][:2] == [-1.5, 0.5]

    def test_an_unsteady_grid_follows_its_beats(self, client, monkeypatch):
        beats = [0, 0.5, 1, 1.5, 2, 2.6, 3.2, 3.8, 4.4, 5.0, 5.6, 6.2, 6.8]
        grid = {**GRID, "steady": False, "beats": beats}
        got = self.view(client, monkeypatch, {"notes": NOTES, "beat_grid": grid})
        # Smoothing may put the first beat a hair after 0, which adds a lead-in bar.
        bars = [t for t in got["measures"] + [got["end"]] if t > -0.1][:3]
        assert bars == pytest.approx([0, 2.0, 4.4], abs=0.05)

    def test_leading_bars_are_never_trimmed(self, client, monkeypatch):
        seen = {}

        def fake(midi, out, quantized, key, chords):
            seen["midi"] = midi
            Path(out).write_text(measures_xml(3))

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        late = [{**NOTES[0], "start": 4.0, "end": 5.0}]
        body_ = {"notes": late, "beat_grid": GRID, "options": {"trim_leading_bars": True}}
        assert client.post("/studio/api/score/view", json=body_).status_code == 200
        midi = mido.MidiFile(file=io.BytesIO(seen["midi"]))
        first = min(
            sum(m.time for m in t[: i + 1])
            for t in midi.tracks
            for i, m in enumerate(t)
            if m.type == "note_on" and m.velocity
        )
        assert first == 8 * midi.ticks_per_beat

    def test_no_musescore_is_explained(self, client, monkeypatch):
        def fake(*args):
            raise MuseScoreNotFoundError("MuseScore was not found.")

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        r = client.post("/studio/api/score/view", json=body())
        assert r.status_code == 503
        assert "MuseScore" in r.json()["detail"]


class TestViewTiming:
    def view(self, client, monkeypatch, json):
        def fake(midi, out, quantized, key, chords):
            Path(out).write_text(measures_xml(4))

        monkeypatch.setattr("studio.app.write_musicxml", fake)
        r = client.post("/studio/api/score/view", json=json)
        assert r.status_code == 200, r.text
        return r.json()

    def test_measures_sit_on_the_tracked_beats_not_the_smoothed_ones(self, client, monkeypatch):
        # Late downbeats: smoothing pulls them about 0.1 s back towards the others.
        beats = [i * 0.5 + (0.12 if i % 4 == 0 and i > 0 else 0) for i in range(25)]
        grid = {**GRID, "steady": False, "beats": beats}
        got = self.view(client, monkeypatch, {"notes": NOTES, "beat_grid": grid})
        bars = [t for t in got["measures"] if t > -0.1][:3]
        assert bars == pytest.approx([0, 2.12, 4.12], abs=0.005)

    def test_a_rescaled_grid_uses_the_rescaled_beats(self, client, monkeypatch):
        # Twice the beats per tracked beat: four of them fill one second.
        beats = [i * 0.5 for i in range(25)]
        grid = {**GRID, "steady": False, "beats": beats}
        got = self.view(
            client, monkeypatch, {"notes": NOTES, "beat_grid": grid, "options": {"beat_scale": 2}}
        )
        bars = [t for t in got["measures"] if t > -0.1][:3]
        assert bars == pytest.approx([0, 1.0, 2.0], abs=0.01)

    def test_without_a_grid_measures_start_with_the_recording(self, client, monkeypatch):
        # No grid means no beats to measure a delay against, so nothing is shifted.
        notes = [{**NOTES[0], "start": 0.18 + 0.5 * i, "end": 0.6 + 0.5 * i} for i in range(8)]
        got = self.view(client, monkeypatch, {"notes": notes})
        assert got["measures"][:2] == [0, 2]
