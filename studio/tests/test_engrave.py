import xml.etree.ElementTree as ET
from pathlib import Path

import mido
import pytest

from studio.analysis import Key
from studio.engrave import (
    add_chords,
    measure_map,
    notes_in_beats,
    prepare_musicxml,
    rewrite_key,
    set_page,
)


def score(measures: int = 4, beats: int = 4, parts: str = "") -> ET.Element:
    bars = "".join(
        f'<measure number="{i + 1}">'
        + (
            f"<attributes><divisions>8</divisions><key><fifths>0</fifths></key>"
            f"<time><beats>{beats}</beats><beat-type>4</beat-type></time></attributes>"
            if i == 0
            else ""
        )
        + "<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration></note></measure>"
        for i in range(measures)
    )
    return ET.fromstring(f'<score-partwise><part id="P1">{bars}</part>{parts}</score-partwise>')


C_MAJOR = Key(tonic=0, mode="major", confidence=1.0)
E_FLAT = Key(tonic=3, mode="major", confidence=1.0)
B_MINOR = Key(tonic=11, mode="minor", confidence=1.0)


def chord(start, root="C", quality="", bass=None):
    return {"start": start, "end": start + 1, "root": root, "quality": quality, "bass": bass}


def pitch_of(note):
    p = note.find("pitch")
    alter = p.find("alter")
    return (p.find("step").text, int(alter.text) if alter is not None else 0, int(p.find("octave").text))


class TestChordPlacement:
    def test_measures_come_from_the_score(self):
        starts, per_beat = measure_map(score(3, beats=3).findall("part/measure"))
        assert starts == [0, 3, 6]
        assert per_beat == [8, 8, 8]

    def test_a_chord_lands_in_its_bar_and_beat(self):
        root = score()
        assert add_chords(root, [chord(6.0)], C_MAJOR) == 1
        bar = root.findall("part/measure")[1]
        harmony = bar.find("harmony")
        assert harmony.find("offset").text == "16"
        assert harmony.find("root/root-step").text == "C"

    def test_a_chord_on_the_bar_line_has_no_offset(self):
        root = score()
        add_chords(root, [chord(4.0)], C_MAJOR)
        assert root.findall("part/measure")[1].find("harmony/offset") is None

    def test_follows_a_meter_change(self):
        root = score(3, beats=3)
        attributes = root.findall("part/measure")[1]
        attributes.insert(0, ET.fromstring("<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"))
        add_chords(root, [chord(7.0)], C_MAJOR)
        third = root.findall("part/measure")[2]
        assert third.find("harmony") is not None

    def test_writes_flats_kind_and_bass(self):
        root = score()
        add_chords(root, [chord(0.0, "Ab", "m7", "Cb")], E_FLAT)
        h = root.find("part/measure/harmony")
        assert h.find("root/root-step").text == "A"
        assert h.find("root/root-alter").text == "-1"
        assert h.find("kind").text == "minor-seventh"
        assert h.find("kind").get("text") == "m7"
        assert h.find("bass/bass-step").text == "C"
        assert h.find("bass/bass-alter").text == "-1"

    def test_several_in_a_bar_stay_in_order(self):
        root = score()
        add_chords(root, [chord(0.0, "C"), chord(2.0, "G")], C_MAJOR)
        roots = [h.find("root/root-step").text for h in root.findall("part/measure/harmony")]
        assert roots == ["C", "G"]

    def test_skips_a_drum_part(self):
        drums = '<part id="D"><measure number="1"><note><unpitched/></note></measure></part>'
        root = ET.fromstring(f'<score-partwise>{drums}<part id="P1"><measure number="1"/></part></score-partwise>')
        add_chords(root, [chord(0.0)], C_MAJOR)
        assert root.find("part[@id='D']/measure/harmony") is None
        assert root.find("part[@id='P1']/measure/harmony") is not None


class TestKeyRewrite:
    def part(self, step="A", alter=1, octave=4, extra=""):
        alter_tag = f"<alter>{alter}</alter>" if alter else ""
        return ET.fromstring(
            '<part id="P"><measure><attributes><key><fifths>-6</fifths></key></attributes>'
            f"<note><pitch><step>{step}</step>{alter_tag}<octave>{octave}</octave></pitch>"
            f"<accidental>sharp</accidental>{extra}</note></measure></part>"
        )

    def test_sets_the_signature(self):
        part = self.part()
        rewrite_key(part, B_MINOR)
        assert part.find(".//fifths").text == "2"
        assert part.find(".//key/mode").text == "minor"

    def test_flat_key_respells_sharps_without_moving_the_pitch(self):
        part = self.part("A", 1)
        rewrite_key(part, E_FLAT)
        assert pitch_of(part.find(".//note")) == ("B", -1, 4)

    def test_b_flat_at_the_octave_edge(self):
        part = self.part("B", 0, 3)
        rewrite_key(part, B_MINOR)
        assert pitch_of(part.find(".//note")) == ("B", 0, 3)

    def test_removes_stale_accidentals(self):
        part = self.part()
        rewrite_key(part, E_FLAT)
        assert part.find(".//accidental") is None

    def test_a_transposing_part_gets_its_written_key(self):
        part = self.part("C", 0)
        part.find("measure/attributes").append(ET.fromstring("<transpose><chromatic>-2</chromatic></transpose>"))
        rewrite_key(part, Key(tonic=10, mode="major", confidence=1.0))
        # A B-flat instrument reads C major for concert B-flat.
        assert part.find(".//fifths").text == "0"


class TestPage:
    def test_sets_and_replaces_the_size(self, tmp_path):
        path = tmp_path / "s.mscx"
        path.write_text("<museScore><Score><Style><pageWidth>9</pageWidth></Style></Score></museScore>")
        set_page(path, "a4")
        text = path.read_text()
        assert "<pageWidth>8.27</pageWidth>" in text
        assert "<pageHeight>11.69</pageHeight>" in text
        assert "<pageWidth>9</pageWidth>" not in text

    def test_adds_a_style_when_there_is_none(self, tmp_path):
        path = tmp_path / "s.mscx"
        path.write_text("<museScore><Score><Part/></Score></museScore>")
        set_page(path, "letter")
        assert "<pageWidth>8.5</pageWidth>" in path.read_text()


def midi_file(path: Path) -> Path:
    midi = mido.MidiFile(ticks_per_beat=480)
    meta, piano, drums = mido.MidiTrack(), mido.MidiTrack(), mido.MidiTrack()
    midi.tracks += [meta, piano, drums]
    meta.append(mido.MetaMessage("time_signature", numerator=3, denominator=4))
    piano.append(mido.Message("program_change", program=33, channel=0))
    piano.append(mido.Message("note_on", note=40, velocity=90, channel=0, time=480))
    piano.append(mido.Message("note_off", note=40, channel=0, time=960))
    drums.append(mido.Message("note_on", note=36, velocity=90, channel=9, time=0))
    drums.append(mido.Message("note_off", note=36, channel=9, time=120))
    midi.save(path)
    return path


class TestMidi:
    def test_reads_notes_in_beats(self, tmp_path):
        notes, per_bar = notes_in_beats(midi_file(tmp_path / "a.mid"))
        assert per_bar == 3
        bass = next(n for n in notes if n.instrument == "electric_bass")
        assert (bass.pitch, bass.start, bass.end) == (40, 1.0, 3.0)
        assert any(n.instrument == "drums" for n in notes)


def test_prepare_reports_the_key_used(tmp_path):
    xml = tmp_path / "s.musicxml"
    ET.ElementTree(score()).write(xml)
    info = prepare_musicxml(xml, midi_file(tmp_path / "a.mid"), E_FLAT, with_chords=False)
    assert info["key"] == "E♭ major"
    assert ET.parse(xml).getroot().find(".//fifths").text == "-3"


@pytest.mark.parametrize(
    "key,fifths",
    [(Key(0, "major", 1), "0"), (Key(7, "major", 1), "1"), (Key(5, "minor", 1), "-4"), (Key(4, "minor", 1), "1")],
)
def test_key_signatures(key, fifths):
    part = ET.fromstring('<part><measure><attributes><key><fifths>0</fifths></key></attributes></measure></part>')
    rewrite_key(part, key)
    assert part.find(".//fifths").text == fifths
