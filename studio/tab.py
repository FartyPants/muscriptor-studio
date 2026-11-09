"""A tab staff under one part of a MusicXML score.

MuseScore writes the score from the MIDI; this adds a second staff to one
part, tablature, with every note's string and fret chosen by `fretboard`.
OSMD draws it on screen and MuseScore prints it, both from the same file.
"""

from __future__ import annotations

import copy
import xml.etree.ElementTree as ET
from collections import defaultdict
from typing import Any, Literal

from pydantic import BaseModel, Field

from studio.fretboard import TUNINGS, Fret, fret_groups, refret_group
from studio.tracks import track_title

STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
SHARP_NAMES = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0),
               ("F", 1), ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0)]  # fmt: skip

# Where <staff> goes in a <note>: before the first of these, else at the end.
AFTER_STAFF = ("beam", "notations", "lyric", "play", "listen")
# Layout from MuseScore's own page, which means nothing on a new staff.
LAYOUT_ATTRIBUTES = ("default-x", "default-y", "relative-x", "relative-y", "dynamics")


class Fretboard(BaseModel):
    """The project's choice of tuning, capo, tab track and chord diagrams."""

    tuning: Literal["guitar", "drop_d", "ukulele", "ukulele_low_g"] = "guitar"
    capo: int = Field(default=0, ge=0, le=7)
    tab: str | None = None
    diagrams: bool = False


def _pitch_of(note: ET.Element) -> int | None:
    pitch = note.find("pitch")
    if pitch is None:
        return None
    alter = round(float(pitch.findtext("alter") or 0))
    return (int(pitch.findtext("octave")) + 1) * 12 + STEPS[pitch.findtext("step")] + alter


def _is_drum_part(part: ET.Element) -> bool:
    return part.find(".//unpitched") is not None


def find_part(root: ET.Element, instrument: str) -> ET.Element | None:
    """The pitched part MuseScore named after `instrument`, e.g. "Classical Guitar, acoustic guitar"."""
    wanted = track_title(instrument).lower()
    names = {sp.get("id"): sp.findtext("part-name") or "" for sp in root.iter("score-part")}
    for part in root.findall("part"):
        track = names.get(part.get("id"), "").rsplit(", ", 1)[-1].strip().lower()
        if track == wanted and not _is_drum_part(part):
            return part
    return None


def _set_staff(note: ET.Element, number: int) -> None:
    for old in note.findall("staff"):
        note.remove(old)
    staff = ET.Element("staff")
    staff.text = str(number)
    children = list(note)
    at = next((i for i, c in enumerate(children) if c.tag in AFTER_STAFF), len(children))
    note.insert(at, staff)


def _is_continuation(note: ET.Element) -> bool:
    return any(t.get("type") == "stop" for t in note.findall("tie"))


def _starts(measure: ET.Element) -> tuple[dict[int, int], int]:
    """Each note's start in divisions, keyed by id(note), and where the measure ends."""
    pos = 0
    last = 0
    starts = {}
    for e in measure:
        if e.tag == "backup":
            pos -= int(e.findtext("duration") or 0)
        elif e.tag == "forward":
            pos += int(e.findtext("duration") or 0)
        elif e.tag == "note":
            if e.find("chord") is not None:
                starts[id(e)] = last
            else:
                starts[id(e)] = last = pos
                if e.find("grace") is None:
                    pos += int(e.findtext("duration") or 0)
    return starts, pos


def _shift_at(measure: ET.Element, shift: int) -> int:
    """Semitones from written to sounding pitch, from this measure on."""
    transpose = measure.find("attributes/transpose")
    if transpose is None:
        return shift
    return int(float(transpose.findtext("chromatic") or 0)) + 12 * int(transpose.findtext("octave-change") or 0)


def _tuning_details(tuning: str, capo: int) -> ET.Element:
    strings = TUNINGS[tuning]
    details = ET.Element("staff-details", number="2")
    ET.SubElement(details, "staff-lines").text = str(len(strings))
    # A capo is written as strings tuned up by its frets, not as <capo>:
    # MuseScore re-frets every note of a staff with <capo> itself, ignoring
    # the strings chosen here. A text mark tells the player instead.
    # Line 1 is the bottom line, which carries the highest-numbered string.
    for line, open_pitch in enumerate((p + capo for p in reversed(strings)), start=1):
        step, alter = SHARP_NAMES[open_pitch % 12]
        tuning_el = ET.SubElement(details, "staff-tuning", line=str(line))
        ET.SubElement(tuning_el, "tuning-step").text = step
        if alter:
            ET.SubElement(tuning_el, "tuning-alter").text = str(alter)
        ET.SubElement(tuning_el, "tuning-octave").text = str(open_pitch // 12 - 1)
    return details


def _capo_mark(capo: int) -> ET.Element:
    direction = ET.Element("direction", placement="above")
    words = ET.SubElement(ET.SubElement(direction, "direction-type"), "words")
    words.text = f"Capo {capo}"
    ET.SubElement(direction, "staff").text = "2"
    return direction


def _add_tab_attributes(measure: ET.Element, tuning: str, capo: int) -> None:
    attributes = measure.find("attributes")
    if attributes is None:
        attributes = ET.Element("attributes")
        measure.insert(0, attributes)
    children = list(attributes)
    clefs = attributes.findall("clef")
    for clef in clefs:
        clef.set("number", clef.get("number", "1"))
    first_clef = children.index(clefs[0]) if clefs else len(children)
    staves = ET.Element("staves")
    staves.text = "2"
    attributes.insert(first_clef, staves)
    children = list(attributes)
    after = max((children.index(c) for c in clefs), default=children.index(staves)) + 1
    tab_clef = ET.Element("clef", number="2")
    ET.SubElement(tab_clef, "sign").text = "TAB"
    ET.SubElement(tab_clef, "line").text = "5"
    attributes.insert(after, tab_clef)
    attributes.insert(after + 1, _tuning_details(tuning, capo))


def _tab_copy(note: ET.Element, spot: Fret | None, shift: int) -> ET.Element:
    """`note` for staff 2: its fitted pitch with a string and fret, or a hidden rest.

    `shift` is the part's written-to-sounding distance: frets play sounding
    pitches, while `<pitch>` stays written, as the part's `<transpose>` expects.
    """
    tab = copy.deepcopy(note)
    for name in LAYOUT_ATTRIBUTES:
        tab.attrib.pop(name, None)
    for tag in ("stem", "beam", "notehead", "accidental", "lyric"):
        for old in tab.findall(tag):
            tab.remove(old)
    voice = tab.find("voice")
    if voice is not None:
        voice.text = str(int(voice.text) + 4)
    if spot is None:
        # A rest keeps the staff's time; nobody needs to see it.
        pitch_el = tab.find("pitch")
        if pitch_el is not None:
            at = list(tab).index(pitch_el)
            tab.remove(pitch_el)
            tab.insert(at, ET.Element("rest"))
            for tie in tab.findall("tie"):
                tab.remove(tie)
            for tied in tab.findall("notations/tied"):
                tab.find("notations").remove(tied)
        tab.set("print-object", "no")
        _set_staff(tab, 2)
        return tab
    octave = tab.find("pitch/octave")
    octave.text = str(int(octave.text) + (spot.pitch - (_pitch_of(tab) + shift)) // 12)
    notations = tab.find("notations")
    if notations is None:
        notations = ET.SubElement(tab, "notations")
    technical = ET.SubElement(notations, "technical")
    ET.SubElement(technical, "string").text = str(spot.string)
    ET.SubElement(technical, "fret").text = str(spot.fret)
    _set_staff(tab, 2)
    return tab


def _hand_lead_to(lead: ET.Element, first: ET.Element) -> None:
    """`first` was its chord's lead: `lead` takes over what only a lead carries."""
    mark = lead.find("chord")
    if mark is not None:
        lead.remove(mark)
    tuplets = first.findall("notations/tuplet")
    if tuplets:
        notations = lead.find("notations")
        if notations is None:
            notations = ET.SubElement(lead, "notations")
        notations.extend(copy.deepcopy(t) for t in tuplets)


def add_tab_staff(root: ET.Element, instrument: str, tuning: str, capo: int) -> dict[str, Any] | None:
    """Give `instrument`'s part a tab staff. None when no one-staff pitched part plays it."""
    part = find_part(root, instrument)
    if part is None:
        return None
    measures = part.findall("measure")
    if measures[0].find("attributes/staves") is not None:
        return None

    # What sounds at each onset, across voices: new notes are one chord for
    # the hand, and tied notes keep the string they started on.
    new: dict[tuple[int, int], list[tuple[ET.Element, int]]] = defaultdict(list)
    tied: dict[tuple[int, int], list[tuple[ET.Element, int]]] = defaultdict(list)
    ends: list[int] = []
    shifts: list[int] = []
    shift = 0
    for index, measure in enumerate(measures):
        shift = _shift_at(measure, shift)
        shifts.append(shift)
        starts, end = _starts(measure)
        ends.append(end)
        for note in measure.findall("note"):
            written = _pitch_of(note)
            if written is not None:
                onset = (index, starts[id(note)])
                (tied if _is_continuation(note) else new)[onset].append((note, written + shift))

    order = sorted(new)
    result = fret_groups([[pitch for _, pitch in new[key]] for key in order], tuning, capo)
    chosen = dict(zip(order, result.groups))

    # In time order, so each tie finds where its note started and a new chord
    # stays off the strings tied notes are still ringing on.
    spots: dict[int, Fret | None] = {}
    held: dict[int, Fret] = {}  # sounding pitch -> where its tie started
    near: int | None = None

    def carry_tie(note: ET.Element, pitch: int, spot: Fret | None) -> None:
        if spot is not None and any(t.get("type") == "start" for t in note.findall("tie")):
            held[pitch] = spot
        else:
            held.pop(pitch, None)

    for key in sorted(set(new) | set(tied)):
        blocked = set()
        seen = set()
        for note, pitch in tied.get(key, []):
            # In unison voices only the first has a note to continue.
            spot = held.get(pitch) if pitch not in seen else None
            seen.add(pitch)
            spots[id(note)] = spot
            if spot is not None:
                blocked.add(spot.string)
            carry_tie(note, pitch, spot)
        frets = chosen.get(key, [])
        if any(f.string in blocked for f in frets):
            before = frets
            frets = refret_group(frets, tuning, capo, blocked, near)
            for old, fresh in zip(before, frets):
                if old.string is not None and fresh.string is None:
                    result.dropped += 1
                    result.moved -= old.pitch != old.source
        for (note, pitch), fret in zip(new.get(key, []), frets):
            spot = fret if fret.string is not None else None
            spots[id(note)] = spot
            carry_tie(note, pitch, spot)
        fretted = [f.fret for f in frets if f.string is not None and f.fret > 0]
        if fretted:
            near = min(fretted)

    _add_tab_attributes(measures[0], tuning, capo)
    if capo:
        first = measures[0]
        first.insert(list(first).index(first.find("attributes")) + 1, _capo_mark(capo))
    for index, measure in enumerate(measures):
        elements = list(measure)
        copies: list[ET.Element] = []
        i = 0
        while i < len(elements):
            e = elements[i]
            if e.tag in ("backup", "forward"):
                copies.append(copy.deepcopy(e))
            if e.tag != "note":
                i += 1
                continue
            # A chord: its first note, then the notes marked <chord/>.
            cluster = [e]
            i += 1
            while i < len(elements) and elements[i].tag == "note" and elements[i].find("chord") is not None:
                cluster.append(elements[i])
                i += 1
            kept = []
            for note in cluster:
                _set_staff(note, 1)
                if note.find("pitch") is None:
                    kept.append(_tab_copy(note, None, shifts[index]))
                elif spots.get(id(note)) is not None:
                    kept.append(_tab_copy(note, spots[id(note)], shifts[index]))
            if not kept:
                # Nothing of it could be played: a hidden rest keeps the time.
                kept = [_tab_copy(cluster[0], None, shifts[index])]
            elif cluster[0].find("pitch") is not None and spots.get(id(cluster[0])) is None:
                _hand_lead_to(kept[0], cluster[0])
            copies.extend(kept)
        backup = ET.SubElement(measure, "backup")
        ET.SubElement(backup, "duration").text = str(ends[index])
        measure.extend(copies)
    return {"moved": result.moved, "dropped": result.dropped}
