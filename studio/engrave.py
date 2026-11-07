"""Sheet music with chord symbols, the right key and a chosen page size.

Follows `muscriptor.utils.sheets.write_sheets`, with one step added: the score
goes through MusicXML, where the key and chord symbols are written in, and then
back into MuseScore for every PDF. Chords are named from the MIDI being engraved
rather than from the recording's seconds, so they sit on its bars and beats
whatever tempo map, quantizing or trimming produced it.
"""

from __future__ import annotations

import re
import shutil
from bisect import bisect_right
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mido

from muscriptor.utils.sheets import (
    _fail,
    _run,
    _write_part_pdfs,
    convert_to_tab_staves,
    find_musescore,
    fretted_parts,
    import_options,
)
from studio.analysis import Key, detect_chords, detect_key

# Inches.
PAGE_SIZES = {"a4": (8.27, 11.69), "letter": (8.5, 11.0)}
PAGE_MARGIN = 0.59

KINDS = {
    "": ("major", ""),
    "m": ("minor", "m"),
    "7": ("dominant", "7"),
    "maj7": ("major-seventh", "maj7"),
    "m7": ("minor-seventh", "m7"),
    "dim": ("diminished", "dim"),
    "sus4": ("suspended-fourth", "sus4"),
}
STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_SPELLING = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0), ("F", 1), ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0)]
FLAT_SPELLING = [("C", 0), ("D", -1), ("D", 0), ("E", -1), ("E", 0), ("F", 0), ("G", -1), ("G", 0), ("A", -1), ("A", 0), ("B", -1), ("B", 0)]
# Fifths for each major tonic, on the circle's friendlier side.
MAJOR_FIFTHS = {0: 0, 1: -5, 2: 2, 3: -3, 4: 4, 5: -1, 6: 6, 7: 1, 8: -4, 9: 3, 10: -2, 11: 5}
BASS_PROGRAMS = range(32, 40)


@dataclass
class ScoreNote:
    """A note in the score: times in beats, for `analysis`."""

    instrument: str
    pitch: int
    start: float
    end: float


def notes_in_beats(midi_path: Path) -> tuple[list[ScoreNote], int]:
    """The MIDI's notes, in quarter-note beats, and its beats per bar."""
    midi = mido.MidiFile(midi_path)
    per_beat = midi.ticks_per_beat
    beats_per_bar = 4
    notes: list[ScoreNote] = []
    for track in midi.tracks:
        tick = 0
        program = {}
        held: dict[tuple[int, int], int] = {}
        for message in track:
            tick += message.time
            if message.type == "time_signature":
                beats_per_bar = message.numerator * 4 // message.denominator or 4
            elif message.type == "program_change":
                program[message.channel] = message.program
            elif message.type == "note_on" and message.velocity > 0:
                held[(message.channel, message.note)] = tick
            elif message.type in ("note_on", "note_off"):
                start = held.pop((message.channel, message.note), None)
                if start is None:
                    continue
                if message.channel == 9:
                    instrument = "drums"
                elif program.get(message.channel) in BASS_PROGRAMS:
                    instrument = "electric_bass"
                else:
                    instrument = "other"
                notes.append(ScoreNote(instrument, message.note, start / per_beat, tick / per_beat))
    return notes, beats_per_bar


def score_chords(notes: list[ScoreNote], beats_per_bar: int, key: Key | None) -> list[dict[str, Any]]:
    """Chords with `start` and `end` in beats."""
    grid = {"bpm": 60.0, "beats_per_bar": beats_per_bar, "first_downbeat": 0.0}
    return detect_chords(notes, grid, key)


def spelled(pitch_class: int, key: Key) -> tuple[str, int]:
    return (FLAT_SPELLING if key.uses_flats else SHARP_SPELLING)[pitch_class % 12]


def _text(parent: ET.Element, tag: str, value: str) -> ET.Element:
    element = ET.SubElement(parent, tag)
    element.text = value
    return element


def _harmony(chord: dict[str, Any], offset: int) -> ET.Element:
    harmony = ET.Element("harmony")
    step, alter = _name_parts(chord["root"])
    root = ET.SubElement(harmony, "root")
    _text(root, "root-step", step)
    if alter:
        _text(root, "root-alter", str(alter))
    kind, text = KINDS[chord["quality"]]
    _text(harmony, "kind", kind).set("text", text)
    if chord.get("bass"):
        step, alter = _name_parts(chord["bass"])
        bass = ET.SubElement(harmony, "bass")
        _text(bass, "bass-step", step)
        if alter:
            _text(bass, "bass-alter", str(alter))
    if offset:
        _text(harmony, "offset", str(offset))
    return harmony


def _name_parts(name: str) -> tuple[str, int]:
    alter = {"#": 1, "b": -1}.get(name[1:2], 0)
    return name[0], alter


def _key_for_part(key: Key, chromatic: int) -> Key:
    return Key(tonic=(key.tonic - chromatic) % 12, mode=key.mode, confidence=key.confidence)


def _fifths(key: Key) -> int:
    major = key.tonic if key.mode == "major" else (key.tonic + 3) % 12
    fifths = MAJOR_FIFTHS[major]
    # F-sharp and G-flat share a pitch class. Match the spelling the notes get.
    return fifths - 12 if fifths == 6 and key.uses_flats else fifths


def rewrite_key(part: ET.Element, key: Key) -> None:
    """Set `part`'s key signature and spell its notes to match."""
    transpose = part.find("measure/attributes/transpose/chromatic")
    local = _key_for_part(key, int(transpose.text)) if transpose is not None else key
    for signature in part.iter("key"):
        fifths = signature.find("fifths")
        if fifths is not None:
            fifths.text = str(_fifths(local))
        mode = signature.find("mode")
        if mode is None:
            mode = ET.SubElement(signature, "mode")
        mode.text = local.mode
    for note in part.iter("note"):
        pitch = note.find("pitch")
        if pitch is None:
            continue
        step = pitch.find("step").text
        alter_tag = pitch.find("alter")
        alter = float(alter_tag.text) if alter_tag is not None else 0
        octave = pitch.find("octave")
        number = (int(octave.text) + 1) * 12 + STEPS[step] + int(alter)
        new_step, new_alter = spelled(number, local)
        pitch.find("step").text = new_step
        if alter_tag is not None:
            pitch.remove(alter_tag)
        if new_alter:
            tag = ET.Element("alter")
            tag.text = str(new_alter)
            pitch.insert(1, tag)
        octave.text = str((number - STEPS[new_step] - new_alter) // 12 - 1)
        # Stale once respelled: MuseScore works accidentals out again on import.
        accidental = note.find("accidental")
        if accidental is not None:
            note.remove(accidental)


def _is_drum_part(part: ET.Element) -> bool:
    return part.find(".//unpitched") is not None


def measure_map(measures: list[ET.Element]) -> tuple[list[float], list[int], float]:
    """Each measure's first beat, its divisions per beat, and where the score ends."""
    divisions = 1
    length = 4.0
    starts, per_beat = [], []
    beat = 0.0
    for measure in measures:
        found = measure.find("attributes/divisions")
        if found is not None:
            divisions = int(float(found.text))
        time = measure.find("attributes/time")
        if time is not None:
            length = int(time.find("beats").text) * 4 / int(time.find("beat-type").text)
        starts.append(beat)
        per_beat.append(divisions)
        beat += length
    return starts, per_beat, beat


def add_chords(root: ET.Element, chords: list[dict[str, Any]]) -> int:
    """Write chord symbols into the first pitched part. Returns how many landed."""
    parts = [p for p in root.findall("part") if not _is_drum_part(p)]
    if not parts:
        return 0
    measures = parts[0].findall("measure")
    starts, per_beat, end = measure_map(measures)
    written = 0
    for chord in chords:
        bar = bisect_right(starts, chord["start"]) - 1
        if bar < 0 or chord["start"] >= end:
            continue
        offset = round((chord["start"] - starts[bar]) * per_beat[bar])
        measure = measures[bar]
        # After the bar's setup, so `offset` follows the divisions it is counted in.
        setup = ("print", "attributes")
        anchor = next((i for i, child in enumerate(measure) if child.tag not in setup), len(measure))
        # After any symbols already placed, so a bar's chords stay in time order.
        while anchor < len(measure) and measure[anchor].tag == "harmony":
            anchor += 1
        measure.insert(anchor, _harmony(chord, offset))
        written += 1
    return written


def prepare_musicxml(path: Path, midi_path: Path, key: Key | None, with_chords: bool) -> dict[str, Any]:
    """Set the key and add chords in `path`. Returns what was used."""
    notes, beats_per_bar = notes_in_beats(midi_path)
    resolved = key or detect_key(notes)
    tree = ET.parse(path)
    root = tree.getroot()
    if resolved:
        for part in root.findall("part"):
            if not _is_drum_part(part):
                rewrite_key(part, resolved)
    chords = score_chords(notes, beats_per_bar, resolved) if with_chords else []
    written = add_chords(root, chords) if chords else 0
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return {"key": resolved.label if resolved else None, "chords": written, "beats_per_bar": beats_per_bar}


def set_page(mscx: Path, page: str) -> None:
    """Set the page size in a MuseScore file's style."""
    width, height = PAGE_SIZES[page]
    printable = width - 2 * PAGE_MARGIN
    text = mscx.read_text(encoding="utf-8")
    style = (
        f"<pageWidth>{width}</pageWidth><pageHeight>{height}</pageHeight>"
        f"<pagePrintableWidth>{printable}</pagePrintableWidth>"
    )
    text = re.sub(r"<(pageWidth|pageHeight|pagePrintableWidth)>[^<]*</\1>\s*", "", text)
    if "<Style>" in text:
        text = text.replace("<Style>", f"<Style>{style}", 1)
    elif "<Style/>" in text:
        text = text.replace("<Style/>", f"<Style>{style}</Style>", 1)
    else:
        text = text.replace("<Score>", f"<Score><Style>{style}</Style>", 1)
    mscx.write_text(text, encoding="utf-8")


def _score_files(binary: str, midi_path: Path, work: Path, quantized: bool, key, with_chords: bool):
    options = work / "import.xml"
    # With a grid, the MIDI's bars are the roll's bars, so MuseScore's
    # human-performance mode must not guess its own meter. Without one, the bars
    # are placeholders, and its guess is the better of the two.
    text = import_options(quantized)
    if quantized:
        text = text.replace("<HumanPerformance>true<", "<HumanPerformance>false<")
    options.write_text(text)
    first = work / "first.mscx"
    proc = _run(binary, ["-M", str(options), "-o", str(first), str(midi_path)])
    if not first.is_file():
        _fail("import the MIDI file", proc)
    musicxml = work / "score.musicxml"
    proc = _run(binary, ["-o", str(musicxml), str(first)])
    if not musicxml.is_file():
        _fail("write MusicXML", proc)
    # Chords need bars that mean something.
    info = prepare_musicxml(musicxml, midi_path, key, with_chords and quantized)
    return musicxml, info


def write_musicxml(
    midi_bytes: bytes, out: Path, quantized: bool, key: Key | None, with_chords: bool
) -> dict[str, Any]:
    binary = find_musescore()
    with tempfile.TemporaryDirectory(prefix="studio-engrave-") as tmp:
        work = Path(tmp)
        midi_path = work / "score.mid"
        midi_path.write_bytes(midi_bytes)
        musicxml, info = _score_files(binary, midi_path, work, quantized, key, with_chords)
        shutil.copyfile(musicxml, out)
    return info


def write_score(
    midi_bytes: bytes,
    out_dir: Path,
    quantized: bool,
    key: Key | None,
    with_chords: bool,
    page: str,
) -> list[Path]:
    """Every file for the score: MIDI, MusicXML, full score, parts and tablature."""
    binary = find_musescore()
    out_dir.mkdir(parents=True, exist_ok=True)
    midi_path = out_dir / "score.mid"
    midi_path.write_bytes(midi_bytes)
    written = [midi_path]
    with tempfile.TemporaryDirectory(prefix="studio-engrave-") as tmp:
        work = Path(tmp)
        musicxml, _ = _score_files(binary, midi_path, work, quantized, key, with_chords)
        kept = out_dir / "score.musicxml"
        shutil.copyfile(musicxml, kept)
        written.append(kept)

        mscx = work / "score.mscx"
        proc = _run(binary, ["-o", str(mscx), str(musicxml)])
        if not mscx.is_file():
            _fail("read the MusicXML back", proc)
        set_page(mscx, page)

        full_score = out_dir / "full_score.pdf"
        proc = _run(binary, ["-o", str(full_score), str(mscx)])
        if not full_score.is_file():
            _fail("render the full score", proc)
        written.append(full_score)
        written.extend(_write_part_pdfs(binary, mscx, out_dir))

        fretted = fretted_parts(mscx)
        if fretted:
            tab = work / "tab.mscx"
            shutil.copyfile(mscx, tab)
            convert_to_tab_staves(tab)
            written.extend(_write_part_pdfs(binary, tab, out_dir, suffix="_tab", only=set(fretted)))
    return written
