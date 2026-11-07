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
