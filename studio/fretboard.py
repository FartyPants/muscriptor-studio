"""Strings and frets for tablature.

Transcribed notes carry only pitches. To write tab, each note needs a string
and a fret that a hand can actually play next to its neighbours. This module
chooses them: notes the instrument can't reach move by octaves, chords with
more notes than strings lose inner notes, and a shortest-path search over all
playable fingerings keeps the hand in as few positions as it can.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import product

# MIDI pitch of each open string, from string 1 (the highest line in tab) down.
TUNINGS: dict[str, tuple[int, ...]] = {
    "guitar": (64, 59, 55, 50, 45, 40),
    "drop_d": (64, 59, 55, 50, 45, 38),
    # Re-entrant: string 4 is a high G, above the C on string 3.
    "ukulele": (69, 64, 60, 67),
    "ukulele_low_g": (69, 64, 60, 55),
}

MAX_FRET = 15
# Fretted notes in one chord lie within four frets: highest minus lowest <= 3.
MAX_SPAN = 3
# Fingerings kept per chord between search steps.
BEAM = 64

# Cost weights. Only their balance matters: low frets and small stretches
# beat everything else, and moving the hand costs more than a slightly higher
# fret, so a passage stays in one position when it can.
FRET_COST = 0.1
SPAN_COST = 0.5
MOVE_COST = 0.3


@dataclass(frozen=True)
class Fret:
    """Where one input pitch is played. `string` is None when it isn't."""

    source: int  # the pitch as transcribed
    pitch: int  # the pitch played, after any octave move
    string: int | None  # 1 = highest
    fret: int | None  # counted from the capo


@dataclass
class FretResult:
    groups: list[list[Fret]] = field(default_factory=list)
    moved: int = 0  # notes played an octave or more from where they were written
    dropped: int = 0  # chord notes left out because the strings ran out


def fit_pitch(pitch: int, tuning: str, capo: int) -> int:
    """`pitch`, moved by octaves until some string can play it."""
    strings = TUNINGS[tuning]
    low = min(strings) + capo
    high = max(strings) + capo + MAX_FRET
    while pitch < low:
        pitch += 12
    while pitch > high:
        pitch -= 12
    return pitch


def _choices(pitch: int, strings: tuple[int, ...], capo: int) -> list[tuple[int, int]]:
    """(string, fret) pairs that play `pitch`."""
    out = []
    for index, open_pitch in enumerate(strings):
        fret = pitch - open_pitch - capo
        if 0 <= fret <= MAX_FRET:
            out.append((index + 1, fret))
    return out


def _span(frets: list[int]) -> int:
    fretted = [f for f in frets if f > 0]
    return max(fretted) - min(fretted) if fretted else 0


def _position(frets: tuple[int, ...]) -> int | None:
    """Where the hand sits: the lowest fretted fret, or None for open strings only."""
    fretted = [f for f in frets if f > 0]
    return min(fretted) if fretted else None


def _local_cost(frets: tuple[int, ...]) -> float:
    return FRET_COST * sum(frets) + SPAN_COST * _span(list(frets))


def _fingerings(
    pitches: list[int], strings: tuple[int, ...], capo: int, max_span: int
) -> list[tuple[tuple[int, int], ...]]:
    """Every way to play all of `pitches` at once, one string each."""
    options = [_choices(p, strings, capo) for p in pitches]
    found = []
    for combo in product(*options):
        used = [s for s, _ in combo]
        if len(set(used)) != len(used):
            continue
        if _span([f for _, f in combo]) > max_span:
            continue
        found.append(combo)
    found.sort(key=lambda c: _local_cost(tuple(f for _, f in c)))
    return found[:BEAM]


def _playable(pitches: list[int], strings: tuple[int, ...], capo: int):
    """Fingerings for `pitches`, and the pitches they cover.

    A hand spans four frets, so a chord that doesn't fit loses inner notes,
    the second lowest first, until the rest can sound together.
    """
    kept = list(pitches)
    while kept:
        found = _fingerings(kept, strings, capo, MAX_SPAN)
        if found:
            return kept, found
        if len(kept) <= 2:
            kept = kept[:-1]
        else:
            del kept[1]
    return [], [()]


def fret_groups(groups: list[list[int]], tuning: str, capo: int = 0) -> FretResult:
    """Strings and frets for each group of pitches that start together."""
    strings = TUNINGS[tuning]
    result = FretResult()
    prepared = []  # (fits: source -> fitted, kept pitches, fingerings)
    for group in groups:
        fitted = {}
        for source in group:
            if source in fitted:
                continue
            fitted[source] = fit_pitch(source, tuning, capo)
            if fitted[source] != source:
                result.moved += 1
        unique = sorted(set(fitted.values()))
        if len(unique) > len(strings):
            # The lowest and the highest carry the music: keep them, then the top.
            keep = [unique[0]] + unique[-(len(strings) - 1):]
            result.dropped += len(unique) - len(keep)
            unique = keep
        kept, options = _playable(unique, strings, capo)
        result.dropped += len(unique) - len(kept)
        prepared.append((fitted, kept, options))

    # Viterbi over the groups: the cheapest path of fingerings, where moving
    # the hand between groups costs MOVE_COST per fret.
    best: list[tuple[float, list[int], int | None]] = [(0.0, [], None)]
    for _, _, options in prepared:
        step = []
        for index, combo in enumerate(options):
            frets = tuple(f for _, f in combo)
            here = _position(frets)
            local = _local_cost(frets)
            choice = None
            for total, path, last in best:
                move = abs(here - last) if here is not None and last is not None else 0
                cost = total + local + MOVE_COST * move
                if choice is None or cost < choice[0]:
                    choice = (cost, path + [index], here if here is not None else last)
            step.append(choice)
        step.sort(key=lambda c: c[0])
        best = step[:BEAM]
    path = best[0][1] if prepared else []

    for (fitted, kept, options), index, group in zip(prepared, path, groups):
        placed = dict(zip(kept, options[index]))
        seen = set()
        frets = []
        for source in group:
            pitch = fitted[source]
            spot = placed.get(pitch) if pitch not in seen else None
            seen.add(pitch)
            if spot is None:
                frets.append(Fret(source, pitch, None, None))
            else:
                frets.append(Fret(source, pitch, spot[0], spot[1]))
        result.groups.append(frets)
    return result
