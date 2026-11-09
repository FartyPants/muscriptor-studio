import io
import xml.etree.ElementTree as ET

import mido
import pytest
from fastapi.testclient import TestClient

from muscriptor.server import ExportNote
from studio.analysis import _weight
from studio.app import create_studio_app
from studio.models import SwitchableModel, make_exporter
from studio.tab import find_part
from studio.tracks import base_instrument, track_title, write_midi


def note(instrument, pitch=60, start=0.0):
    return {"instrument": instrument, "pitch": pitch, "start": start, "end": start + 1.0}


@pytest.fixture(scope="module")
def exporter():
    return make_exporter()


@pytest.fixture
def client(tmp_path, exporter):
    holder = SwitchableModel(
        loader=lambda s, d: None, free=lambda: None, exporter=exporter, weights={}
    )
    return TestClient(create_studio_app(holder, data_dir=tmp_path, tagger=None))


def note_tracks(midi: bytes):
    """Each track with notes: its name, program and channel, and how many notes."""
    found = {}
    for track in mido.MidiFile(file=io.BytesIO(midi)).tracks:
        ons = [m for m in track if m.type == "note_on" and m.velocity > 0]
        if not ons:
            continue
        name = next(m.name for m in track if m.type == "track_name")
        program = next((m.program for m in track if m.type == "program_change"), None)
        found[name] = {"program": program, "channel": ons[0].channel, "notes": len(ons)}
    return found


def test_names():
    assert base_instrument("acoustic_guitar#2") == "acoustic_guitar"
    assert base_instrument("acoustic_guitar") == "acoustic_guitar"
    assert track_title("acoustic_guitar#2") == "acoustic guitar 2"
    assert track_title("acoustic_guitar") == "acoustic guitar"


def test_a_split_track_exports_as_its_own_track_of_the_same_instrument(client):
    notes = [
        note("acoustic_guitar", 50),
        note("acoustic_guitar", 52, 1.0),
        note("acoustic_guitar#2", 76),
        note("drums", 36),
    ]
    r = client.post("/studio/api/export", json={"notes": notes})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/midi"
    tracks = note_tracks(r.content)
    assert set(tracks) == {"acoustic guitar", "acoustic guitar 2", "drums"}
    first, second = tracks["acoustic guitar"], tracks["acoustic guitar 2"]
    assert first["program"] == second["program"] == 24
    assert first["channel"] != second["channel"]
    assert (first["notes"], second["notes"]) == (2, 1)


def test_two_split_tracks_stay_apart_and_no_real_program_is_taken(client):
    notes = [
        note("acoustic_piano", 60),
        note("violin", 62),
        note("violin#2", 74),
        note("violin#3", 86),
    ]
    tracks = note_tracks(client.post("/studio/api/export", json={"notes": notes}).content)
    assert set(tracks) == {"acoustic piano", "violin", "violin 2", "violin 3"}
    assert tracks["acoustic piano"]["program"] == 0
    assert tracks["violin 2"]["program"] == tracks["violin"]["program"]
    assert tracks["violin 3"]["program"] == tracks["violin"]["program"]


def test_a_program_already_in_use_is_not_taken_for_a_split_track(exporter):
    notes = [
        ExportNote(instrument=name, pitch=60, start=0.0, end=1.0)
        for name in ("program_0", "program_1", "violin", "violin#2")
    ]
    tracks = note_tracks(write_midi(exporter.events_to_midi_bytes, notes))
    assert tracks["program 0"]["program"] == 0
    assert tracks["program 1"]["program"] == 1
    assert tracks["violin 2"]["program"] == tracks["violin"]["program"] == 40


def test_only_the_split_track_can_be_exported(client):
    tracks = note_tracks(
        client.post("/studio/api/export", json={"notes": [note("acoustic_guitar#2")]}).content
    )
    assert tracks["acoustic guitar 2"]["program"] == 24


def test_a_song_with_no_split_track_is_the_same_as_upstreams_export(client):
    body = {"notes": [note("acoustic_guitar", 50), note("drums", 36)]}
    ours = client.post("/studio/api/export", json=body).content
    assert ours == client.post("/export", json=body).content


def test_options_reach_the_export(client):
    grid = {"bpm": 120, "beats_per_bar": 3, "first_downbeat": 0, "onset_delay": 0.0, "steady": True}
    body = {"notes": [note("violin#2")], "beat_grid": grid}
    midi = mido.MidiFile(file=io.BytesIO(client.post("/studio/api/export", json=body).content))
    meter = next(m for track in midi.tracks for m in track if m.type == "time_signature")
    assert meter.numerator == 3


def test_unknown_instruments_are_refused(client):
    r = client.post("/studio/api/export", json={"notes": [note("banana#2")]})
    assert r.status_code == 400
    assert "banana" in r.json()["detail"]


def test_a_split_bass_still_counts_as_bass():
    class Note:
        def __init__(self, instrument):
            self.instrument = instrument
            self.pitch = 60

    assert _weight(Note("electric_bass#2")) == _weight(Note("electric_bass"))
    assert _weight(Note("electric_bass#2")) > _weight(Note("violin"))


def test_tab_finds_the_split_track():
    root = ET.fromstring(
        "<score-partwise><part-list>"
        '<score-part id="P1"><part-name>Contra Guitar, acoustic guitar</part-name></score-part>'
        '<score-part id="P2"><part-name>Contra Guitar, acoustic guitar 2</part-name></score-part>'
        '</part-list><part id="P1"/><part id="P2"/></score-partwise>'
    )
    assert find_part(root, "acoustic_guitar#2").get("id") == "P2"
    assert find_part(root, "acoustic_guitar").get("id") == "P1"
