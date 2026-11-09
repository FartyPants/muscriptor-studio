"""Tracks split from one instrument, such as `acoustic_guitar#2`.

A note's `instrument` names its track, so a split track only needs a new name.
That name doesn't mean a sound, though, so anything asking what a track sounds
like goes through `base_instrument`.
"""

from __future__ import annotations

import io
from collections.abc import Callable
from typing import Any

import mido

from muscriptor.server import ExportNote, export_events
from muscriptor.tokenizer.mt3 import MT3_FULL_PLUS_GROUP_NAMES, get_group_program_map

DRUMS = "drums"
SPLIT_MARK = "#"

_GROUP_PROGRAMS = get_group_program_map(
    "MT3_FULL_PLUS", misc_programs="SINGLETON_GROUPS", is_mt3=True
)


def base_instrument(name: str) -> str:
    """The instrument a track plays: `acoustic_guitar#2` plays `acoustic_guitar`."""
    return name.split(SPLIT_MARK, 1)[0]


def track_title(name: str) -> str:
    """The track's name in a file: `acoustic_guitar#2` is "acoustic guitar 2"."""
    return name.replace("_", " ").replace(SPLIT_MARK, " ")


def _is_split(name: str) -> bool:
    return SPLIT_MARK in name


def _program(name: str) -> int:
    """The MIDI program upstream writes for `name`."""
    if name.startswith("program_"):
        return int(name.removeprefix("program_"))
    return _GROUP_PROGRAMS[MT3_FULL_PLUS_GROUP_NAMES[name]][0]


def _restored(midi: bytes, stand_ins: dict[int, str]) -> bytes:
    """`midi` with each stand-in program's track given its real program and name."""
    file = mido.MidiFile(file=io.BytesIO(midi))
    for track in file.tracks:
        names = [m.name for m in track if m.type == "track_name"]
        wanted = next(
            (s for number, s in stand_ins.items() if f"program {number}" in names),
            None,
        )
        if wanted is None:
            continue
        for at, message in enumerate(track):
            if message.type == "track_name":
                track[at] = message.copy(name=track_title(wanted))
            elif message.type == "program_change":
                track[at] = message.copy(program=_program(base_instrument(wanted)))
    out = io.BytesIO()
    file.save(file=out)
    return out.getvalue()


def write_midi(write: Callable[..., bytes], notes: list[ExportNote], **options: Any) -> bytes:
    """The MIDI for `notes`, written by `events_to_midi_bytes` (`write`).

    Upstream keeps one track per program, so a split track goes in as an unused
    program, which keeps it apart, and gets its real one back afterwards.
    """
    split = sorted({n.instrument for n in notes if _is_split(n.instrument)})
    if not split:
        return write(iter(export_events(notes)), **options)
    taken = {
        _program(n.instrument)
        for n in notes
        if not _is_split(n.instrument) and n.instrument != DRUMS
    }
    spare = (program for program in range(128) if program not in taken)
    numbers = {name: next(spare) for name in split}
    stood_in = [
        n.model_copy(update={"instrument": f"program_{numbers[n.instrument]}"})
        if n.instrument in numbers
        else n
        for n in notes
    ]
    midi = write(iter(export_events(stood_in)), **options)
    return _restored(midi, {number: name for name, number in numbers.items()})
