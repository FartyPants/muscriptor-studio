import random
import time
from dataclasses import dataclass

import numpy as np
import pytest
from fastapi.testclient import TestClient

from studio.analysis import Key, analysis_windows, analyze, detect_key
from studio.app import create_studio_app
from studio.models import SwitchableModel

GRID = {"bpm": 120.0, "beats_per_bar": 4, "first_downbeat": 0.0, "onset_delay": 0.0}
TRIADS = {
    "C": (60, 64, 67),
    "Am": (57, 60, 64),
    "F": (53, 57, 60),
    "G": (55, 59, 62),
    "Dm": (50, 57, 62),
    "Em": (52, 59, 64),
    "Eb": (51, 55, 58),
    "Ab": (56, 60, 63),
    "Bb": (46, 58, 62),
    "Cm": (48, 55, 63),
}


@dataclass
class N:
    instrument: str
    pitch: int
    start: float
    end: float


def bar_of(pitches, bar, instrument="acoustic_piano", bars=1, seconds=2.0):
    start = bar * seconds
    return [N(instrument, p, start, start + bars * seconds) for p in pitches]


def progression(names, bars_each=1):
    notes = []
    for i, name in enumerate(names):
        notes += bar_of(TRIADS[name], i * bars_each, bars=bars_each)
    return notes


def labels(notes, grid=GRID):
    return [c["label"] for c in analyze(notes, grid)["chords"]]


class TestKey:
    @pytest.mark.parametrize(
        "names,expected",
        [
            (["C", "Am", "F", "G", "C", "F", "G", "C"], "C major"),
            (["Am", "Dm", "Em", "Am", "F", "G", "Am", "Am"], "A minor"),
            (["Eb", "Ab", "Bb", "Eb", "Cm", "Ab", "Bb", "Eb"], "E♭ major"),
        ],
    )
    def test_common_progressions(self, names, expected):
        assert detect_key(progression(names)).label == expected

    def test_a_scale_gives_its_key(self):
        scale = [60, 62, 64, 65, 67, 69, 71, 72]
        notes = [N("violin", p, i * 0.5, i * 0.5 + 0.5) for i, p in enumerate(scale * 4)]
        assert detect_key(notes).label == "C major"

    def test_drums_do_not_count(self):
        notes = progression(["C", "G", "C", "F"])
        noise = [N("drums", 42 + i % 5, i * 0.1, i * 0.1 + 0.05) for i in range(200)]
        assert detect_key(notes + noise).label == detect_key(notes).label

    def test_too_little_to_tell(self):
        assert detect_key([]) is None
        assert detect_key([N("violin", 60, 0, 1), N("violin", 72, 1, 2)]) is None


class TestChords:
    def test_a_simple_progression(self):
        # No bass part, so the piano's voicing decides the inversions.
        got = analyze(progression(["C", "Am", "F", "G"]), GRID)["chords"]
        assert [c["root"] + c["quality"] for c in got] == ["C", "Am", "F", "G"]

    def test_chords_change_on_the_bar(self):
        chords = analyze(progression(["C", "G", "Am", "F"]), GRID)["chords"]
        assert [c["start"] for c in chords] == [0.0, 2.0, 4.0, 6.0]
        assert chords[-1]["end"] == 8.0

    def test_root_position_bass_gives_no_slash(self):
        notes = []
        for bar, (bass, name) in enumerate([(36, "C"), (43, "G"), (45, "Am"), (41, "F")]):
            notes += bar_of(TRIADS[name], bar) + bar_of([bass], bar, "electric_bass")
        assert labels(notes) == ["C", "G", "Am", "F"]

    def test_an_inversion_is_a_slash_chord(self):
        notes = bar_of(TRIADS["Eb"], 0, bars=2) + bar_of(TRIADS["Bb"], 2, bars=2)
        notes += bar_of((68, 72, 75), 4, bars=2) + bar_of([48], 4, "electric_bass", bars=2)
        assert "Ab/C" in labels(notes)

    @pytest.mark.parametrize(
        "pitches,bass,expected",
        [
            ((60, 64, 67, 70), 36, "C7"),
            ((60, 64, 67, 71), 36, "Cmaj7"),
            ((60, 63, 67, 70), 36, "Cm7"),
            ((59, 62, 65), 35, "Bdim"),
            ((60, 65, 67), 36, "Csus4"),
        ],
    )
    def test_chord_qualities(self, pitches, bass, expected):
        notes = bar_of(pitches, 0, bars=4) + bar_of([bass], 0, "electric_bass", bars=4)
        assert labels(notes) == [expected]

    def test_a_passing_melody_note_does_not_change_the_chord(self):
        notes = progression(["C", "G"], bars_each=2)
        notes += [N("violin", 74, 0.5, 0.75), N("violin", 77, 1.0, 1.25)]
        assert [c["root"] for c in analyze(notes, GRID)["chords"]] == ["C", "G"]

    def test_arpeggios_read_as_a_chord(self):
        notes = []
        for bar, name in enumerate(["C", "F"] * 2):
            for beat, pitch in enumerate((*TRIADS[name], TRIADS[name][1])):
                start = bar * 2 + beat * 0.5
                notes.append(N("acoustic_guitar", pitch, start, start + 0.5))
        assert [c["root"] for c in analyze(notes, GRID)["chords"]] == ["C", "F", "C", "F"]

    def test_uses_flats_in_a_flat_key(self):
        got = labels(progression(["Eb", "Ab", "Bb", "Eb", "Cm", "Ab", "Bb", "Eb"]))
        assert all("#" not in label for label in got)
        assert any(label.startswith("Eb") for label in got)

    def test_uses_sharps_in_a_sharp_key(self):
        e, a, b = (52, 56, 59), (57, 61, 64), (59, 63, 66)
        notes = []
        for bar, chord in enumerate([e, a, b, e, a, b, e, e]):
            notes += bar_of(chord, bar)
        assert any(c["root"] == "E" for c in analyze(notes, GRID)["chords"])
        assert not any("b" in c["label"].replace("Bb", "b") for c in analyze(notes, GRID)["chords"])

    def test_silence_leaves_a_gap(self):
        notes = bar_of(TRIADS["C"], 0) + bar_of(TRIADS["G"], 4)
        chords = analyze(notes, GRID)["chords"]
        assert [c["root"] for c in chords] == ["C", "G"]
        assert chords[0]["end"] <= 2.5
        assert chords[1]["start"] >= 7.5

    def test_drums_alone_have_no_chords(self):
        notes = [N("drums", 42, i * 0.25, i * 0.25 + 0.05) for i in range(64)]
        assert analyze(notes, GRID) == {"key": None, "detected": None, "chords": []}

    def test_nothing_at_all(self):
        assert analyze([], GRID) == {"key": None, "detected": None, "chords": []}

    def test_a_chosen_key_replaces_the_detected_one(self):
        notes = progression(["Eb", "Ab", "Bb", "Eb"])
        chosen = Key(tonic=1, mode="minor", confidence=1.0)
        got = analyze(notes, GRID, chosen)
        assert got["key"]["label"] == "C♯ minor"
        assert got["key"]["scale"] == sorted(chosen.scale)
        assert got["detected"]["label"] == "E♭ major"

    def test_a_chosen_key_decides_sharps_or_flats(self):
        notes = progression(["Eb", "Ab", "Bb", "Eb"])
        sharp = analyze(notes, GRID, Key(tonic=1, mode="minor", confidence=1.0))
        assert any(c["root"] == "D#" for c in sharp["chords"])

    def test_works_without_a_grid(self):
        chords = analyze(progression(["C", "F", "G", "C"], bars_each=2), None)["chords"]
        assert [c["root"] for c in chords] == ["C", "F", "G", "C"]

    def test_follows_an_unsteady_grid(self):
        beats = [0.0, 0.6, 1.1, 1.8, 2.5, 3.0, 3.7, 4.3, 5.0]
        grid = {**GRID, "steady": False, "beats": beats}
        notes = [N("acoustic_piano", p, 0.0, 2.5) for p in TRIADS["C"]]
        notes += [N("acoustic_piano", p, 2.5, 5.0) for p in TRIADS["G"]]
        chords = analyze(notes, grid)["chords"]
        assert [c["root"] for c in chords] == ["C", "G"]
        assert chords[1]["start"] == 2.5

    def test_an_edit_changes_the_answer(self):
        notes = bar_of((60, 64, 67), 0, bars=4)
        assert labels(notes) == ["C"]
        notes = bar_of((60, 63, 67), 0, bars=4)
        assert labels(notes) == ["Cm"]

    def test_is_quick_on_ten_thousand_notes(self):
        rng = random.Random(1)
        notes = [
            N("violin", rng.randint(40, 84), t, t + rng.uniform(0.1, 0.8))
            for t in (rng.uniform(0, 300) for _ in range(10000))
        ]
        started = time.perf_counter()
        analyze(notes, GRID)
        assert time.perf_counter() - started < 1.0


class TestWindows:
    def test_follows_the_beats(self):
        assert list(analysis_windows(2.0, GRID)) == [0.0, 0.5, 1.0, 1.5, 2.0]

    def test_starts_at_zero_with_a_late_first_downbeat(self):
        edges = analysis_windows(2.0, {**GRID, "first_downbeat": 0.75})
        assert list(edges) == [0.0, 0.25, 0.75, 1.25, 1.75, 2.0]

    def test_doubled_tempo_does_not_make_tiny_windows(self):
        assert np.median(np.diff(analysis_windows(30.0, {**GRID, "bpm": 400.0}))) >= 0.4

    def test_no_grid_uses_fixed_spans(self):
        assert list(analysis_windows(2.5, None)) == [0.0, 1.0, 2.0, 2.5]

    def test_edges_always_increase(self):
        grid = {**GRID, "steady": False, "beats": [0.0, 0.0, 1.0, 1.0, 2.0]}
        assert np.all(np.diff(analysis_windows(3.0, grid)) > 0)


class TestRoute:
    @pytest.fixture
    def client(self, tmp_path):
        holder = SwitchableModel(
            loader=lambda s, d: None, free=lambda: None, exporter=object(), weights={}
        )
        return TestClient(create_studio_app(holder, data_dir=tmp_path))

    def note(self, pitch, start, end, instrument="acoustic_piano"):
        return {"id": "x", "instrument": instrument, "pitch": pitch, "start": start, "end": end}

    def test_returns_key_and_chords_without_a_model(self, client):
        notes = [self.note(p, 0.0, 4.0) for p in (60, 64, 67)]
        r = client.post("/studio/api/analysis", json={"notes": notes, "beat_grid": GRID})
        assert r.status_code == 200
        assert [c["label"] for c in r.json()["chords"]] == ["C"]

    def test_takes_out_the_onset_delay(self, client):
        grid = {**GRID, "onset_delay": 0.03}
        notes = [self.note(p, 0.03, 2.03) for p in (60, 64, 67)]
        notes += [self.note(p, 2.03, 4.03) for p in (55, 59, 62)]
        chords = client.post("/studio/api/analysis", json={"notes": notes, "beat_grid": grid}).json()["chords"]
        assert [c["start"] for c in chords] == [0.0, 2.0]

    def test_a_null_grid_works(self, client):
        notes = [self.note(p, 0.0, 4.0) for p in (60, 64, 67)]
        r = client.post("/studio/api/analysis", json={"notes": notes, "beat_grid": None})
        assert r.status_code == 200
