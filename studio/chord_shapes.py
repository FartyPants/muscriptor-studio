"""Chord diagrams: a playable shape for each chord, on guitar or ukulele.

A small search over the fretboard. Each string is muted, open, or fretted
inside a four-fret window, and only chord tones may sound. Of the shapes that
play every tone (the fifth may go), the cheapest wins: low on the neck, few
fingers, few muted strings.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from itertools import product

from studio.analysis import QUALITIES
from studio.fretboard import TUNINGS

INTERVALS = {suffix: intervals for suffix, intervals, _ in QUALITIES}
PITCH_CLASSES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}

WINDOW = 4  # frets a hand covers
HIGHEST_BASE = 10  # the highest fret a window may start at
FINGERS = 4
GUITAR_MIN_STRINGS = 4  # a guitar shape plays at least this many strings

# Cost weights: how high on the neck matters most, then muted strings, then
# fingers. Tests pin the common open shapes these choose.
POSITION_COST = 1.0
MUTED_COST = 0.5
FINGER_COST = 0.3


@dataclass(frozen=True)
class Shape:
    """Frets from string 1 (highest) down, None for a muted string.

    Frets count from the capo. `first_fret` is the diagram's top fret.
    """

    frets: tuple[int | None, ...]
    first_fret: int

    def as_json(self) -> dict:
        return {"frets": list(self.frets), "first_fret": self.first_fret}


def pitch_class(name: str) -> int:
    """'F#' -> 6, 'Bb' -> 10."""
    alter = {"#": 1, "b": -1}.get(name[1:2], 0)
    return (PITCH_CLASSES[name[0]] + alter) % 12


def _is_ukulele(tuning: str) -> bool:
    return tuning.startswith("ukulele")


def _fingers(frets: tuple[int | None, ...]) -> int:
    """Fingers a shape needs, with one finger barring its lowest fret where it can."""
    fretted = [(s, f) for s, f in enumerate(frets) if f]
    if not fretted:
        return 0
    low = min(f for _, f in fretted)
    at_low = [s for s, f in fretted if f == low]
    # A barre lies across every string from its farthest one to string 1, so no
    # string under it may ring open.
    barre = len(at_low) > 1 and all(frets[s] != 0 for s in range(max(at_low) + 1))
    others = len(fretted) - len(at_low)
    return others + (1 if barre else len(at_low))


def _cost(frets: tuple[int | None, ...]) -> float:
    played = [f for f in frets if f is not None]
    position = max(played) if played else 0
    muted = sum(1 for f in frets if f is None)
    return POSITION_COST * position + MUTED_COST * muted + FINGER_COST * _fingers(frets)


@lru_cache(maxsize=4096)
def chord_shape(root: int, quality: str, bass: int | None, tuning: str, capo: int = 0) -> Shape | None:
    """The cheapest playable shape, or None when there is none."""
    strings = TUNINGS[tuning]
    tones = {(root + i) % 12 for i in INTERVALS[quality]}
    fifth = (root + 7) % 12
    required = tones - {fifth} if fifth in tones else tones
    ukulele = _is_ukulele(tuning)
    lowest_wanted = root if bass is None else bass

    best: tuple[float, tuple[int | None, ...]] | None = None
    for base in range(1, HIGHEST_BASE + 1):
        options = []
        for open_pitch in strings:
            here = [None] if not ukulele else []
            for fret in [0, *range(base, base + WINDOW)]:
                if (open_pitch + capo + fret) % 12 in tones:
                    here.append(fret)
            options.append(here)
        for frets in product(*options):
            played = [(s, f) for s, f in enumerate(frets) if f is not None]
            if ukulele:
                if len(played) < len(strings):
                    continue
            else:
                if len(played) < GUITAR_MIN_STRINGS:
                    continue
                # Muted strings only on the bass side, below the lowest one played.
                lowest_string = max(s for s, _ in played)
                if any(frets[s] is None for s in range(lowest_string)):
                    continue
                low_pitch = strings[lowest_string] + capo + frets[lowest_string]
                if low_pitch % 12 != lowest_wanted:
                    continue
            sounding = {(strings[s] + capo + f) % 12 for s, f in played}
            if not required <= sounding:
                continue
            if _fingers(frets) > FINGERS:
                continue
            cost = _cost(frets)
            if best is None or cost < best[0]:
                best = (cost, frets)
    if best is None:
        # A slash chord with no shape on its bass still gets its chord's shape.
        return chord_shape(root, quality, None, tuning, capo) if bass is not None else None
    frets = best[1]
    fretted = [f for f in frets if f]
    top = max(fretted, default=0)
    first = 1 if top <= WINDOW else min(fretted)
    return Shape(frets, first)


def shape_for_chord(chord: dict, tuning: str, capo: int) -> Shape | None:
    """`chord_shape` for one of `analysis.detect_chords`'s chords."""
    bass = pitch_class(chord["bass"]) if chord.get("bass") else None
    return chord_shape(pitch_class(chord["root"]), chord["quality"], bass, tuning, capo)
