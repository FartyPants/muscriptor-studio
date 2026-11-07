"""Key and chord names, worked out from the notes.

Rule-based, so it needs no model and can rerun after every edit. It reads what
was transcribed, not the audio, so it can only be as right as the notes are.
Works in display time: the caller's notes with the grid's `onset_delay` removed,
which is where the bar lines sit.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Krumhansl-Kessler key profiles.
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

MAJOR_SCALE = frozenset({0, 2, 4, 5, 7, 9, 11})
# Natural minor plus the raised seventh, for the usual dominant chord.
MINOR_SCALE = frozenset({0, 2, 3, 5, 7, 8, 10, 11})

MAJOR_KEY_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MINOR_KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
# Tonics whose key signature uses flats.
FLAT_MAJOR = frozenset({0, 1, 3, 5, 8, 10})  # includes C, which has neither
FLAT_MINOR = frozenset({0, 2, 3, 5, 7, 10})

# Suffix, intervals above the root, and how far the chord starts behind a triad.
# The handicap stops a passing melody note turning every triad into a seventh.
QUALITIES: tuple[tuple[str, tuple[int, ...], float], ...] = (
    ("", (0, 4, 7), 0.0),
    ("m", (0, 3, 7), 0.0),
    ("7", (0, 4, 7, 10), 0.04),
    ("maj7", (0, 4, 7, 11), 0.06),
    ("m7", (0, 3, 7, 10), 0.04),
    ("dim", (0, 3, 6), 0.08),
    ("sus4", (0, 5, 7), 0.08),
)

NO_CHORD_SCORE = 0.5  # a chord must fit better than this to be named
CHANGE_PENALTY = 0.4  # score a change must gain, so chords don't flicker
IN_KEY_BONUS = 0.02
BASS_INSTRUMENTS = frozenset({"acoustic_bass", "electric_bass", "contrabass"})
BASS_WEIGHT = 2.0
LOW_NOTE_PITCH = 48
LOW_NOTE_WEIGHT = 1.5
NO_GRID_WINDOW_SEC = 1.0
FASTEST_WINDOW_SEC = 0.4
# A note must sound this share of a chord to count as its bass.
BASS_MIN_SHARE = 0.1


@dataclass(frozen=True)
class Key:
    tonic: int
    mode: str  # "major" or "minor"
    confidence: float  # correlation with the key's profile, -1 to 1

    @property
    def uses_flats(self) -> bool:
        return self.tonic in (FLAT_MAJOR if self.mode == "major" else FLAT_MINOR)

    @property
    def label(self) -> str:
        names = MAJOR_KEY_NAMES if self.mode == "major" else MINOR_KEY_NAMES
        return f"{names[self.tonic].replace('b', '♭').replace('#', '♯')} {self.mode}"

    @property
    def scale(self) -> set[int]:
        scale = MAJOR_SCALE if self.mode == "major" else MINOR_SCALE
        return {(self.tonic + step) % 12 for step in scale}


def _melodic(notes: Sequence[Any]) -> list[Any]:
    """Notes with pitch: drum "pitches" name a drum, not a note."""
    return [n for n in notes if n.instrument != "drums"]


def _weight(note: Any) -> float:
    weight = BASS_WEIGHT if note.instrument in BASS_INSTRUMENTS else 1.0
    return weight * LOW_NOTE_WEIGHT if note.pitch < LOW_NOTE_PITCH else weight


def detect_key(notes: Sequence[Any]) -> Key | None:
    """The best-fitting key, or None without enough to go on."""
    chroma = np.zeros(12)
    for n in _melodic(notes):
        chroma[n.pitch % 12] += max(0.0, n.end - n.start)
    if np.count_nonzero(chroma) < 3:
        return None
    candidates = []
    for tonic in range(12):
        candidates.append((np.corrcoef(chroma, np.roll(MAJOR_PROFILE, tonic))[0, 1], tonic, "major"))
        candidates.append((np.corrcoef(chroma, np.roll(MINOR_PROFILE, tonic))[0, 1], tonic, "minor"))
    score, tonic, mode = max(candidates)
    return Key(tonic=tonic, mode=mode, confidence=round(float(score), 3))


def _beat_times(grid: dict[str, Any], end: float) -> np.ndarray:
    beats = grid.get("beats")
    if grid.get("steady") is False and beats and len(beats) >= 2:
        return np.asarray(beats, dtype=float)
    period = 60.0 / grid["bpm"]
    first = grid.get("first_downbeat", 0.0) or 0.0
    first -= np.floor(first / period) * period
    return np.arange(first, end + period, period)


def analysis_windows(end: float, grid: dict[str, Any] | None) -> np.ndarray:
    """Edges of the spans to name a chord for, from 0 to `end`, always increasing."""
    if grid is None or not grid.get("bpm"):
        edges = np.arange(0.0, end, NO_GRID_WINDOW_SEC)
    else:
        edges = _beat_times(grid, end)
        # A tracker that doubled the tempo shouldn't make the windows too short.
        while len(edges) > 2 and np.median(np.diff(edges)) < FASTEST_WINDOW_SEC:
            edges = edges[::2]
        edges = edges[(edges > 0) & (edges < end)]
    return np.unique(np.concatenate([[0.0], edges, [end]]))


def _chroma_by_window(notes: Sequence[Any], edges: np.ndarray) -> np.ndarray:
    chroma = np.zeros((len(edges) - 1, 12))
    for n in notes:
        first = max(0, int(np.searchsorted(edges, n.start, side="right")) - 1)
        last = min(len(edges) - 2, int(np.searchsorted(edges, n.end, side="left")) - 1)
        weight = _weight(n)
        for w in range(first, last + 1):
            overlap = min(n.end, edges[w + 1]) - max(n.start, edges[w])
            if overlap > 0:
                chroma[w, n.pitch % 12] += overlap * weight
    return chroma


def _templates(
    key: Key | None,
) -> tuple[np.ndarray, list[tuple[int, str, tuple[int, ...]]], np.ndarray]:
    """A unit vector per chord, its identity, and what to add to its score."""
    vectors, adjustments, chords = [], [], []
    scale = key.scale if key else None
    for root in range(12):
        for suffix, intervals, handicap in QUALITIES:
            vector = np.zeros(12)
            tones = tuple((root + i) % 12 for i in intervals)
            vector[list(tones)] = 1.0
            vectors.append(vector / np.linalg.norm(vector))
            bonus = IN_KEY_BONUS if scale and set(tones) <= scale else 0.0
            adjustments.append(bonus - handicap)
            chords.append((root, suffix, tones))
    return np.array(vectors), chords, np.array(adjustments)


def _best_path(scores: np.ndarray) -> np.ndarray:
    """The state per window with the best total score, paying for each change."""
    windows, states = scores.shape
    total = scores[0].copy()
    back = np.zeros((windows, states), dtype=int)
    for t in range(1, windows):
        best = int(np.argmax(total))
        switch = total[best] - CHANGE_PENALTY
        stay = total >= switch
        back[t] = np.where(stay, np.arange(states), best)
        total = np.where(stay, total, switch) + scores[t]
    path = np.zeros(windows, dtype=int)
    path[-1] = int(np.argmax(total))
    for t in range(windows - 1, 0, -1):
        path[t - 1] = back[t, path[t]]
    return path


def _bass(notes: Sequence[Any], start: float, end: float) -> int | None:
    """Pitch class of the lowest note sounding for a real share of the span."""
    time_at_pitch: dict[int, float] = {}
    for n in notes:
        overlap = min(n.end, end) - max(n.start, start)
        if overlap > 0:
            time_at_pitch[n.pitch] = time_at_pitch.get(n.pitch, 0.0) + overlap
    for pitch in sorted(time_at_pitch):
        if time_at_pitch[pitch] >= (end - start) * BASS_MIN_SHARE:
            return pitch % 12
    return None


def detect_chords(notes: Sequence[Any], grid: dict[str, Any] | None, key: Key | None) -> list[dict[str, Any]]:
    """Named spans `{start, end, root, quality, bass, label}`, gaps where nothing fits."""
    pitched = _melodic(notes)
    if not pitched:
        return []
    end = max(n.end for n in pitched)
    edges = analysis_windows(end, grid)
    chroma = _chroma_by_window(pitched, edges)
    # Square root, so a heavy bass helps find the root without burying the third
    # and seventh above it.
    compressed = np.sqrt(chroma)
    energy = np.linalg.norm(compressed, axis=1, keepdims=True)
    unit = np.divide(compressed, energy, out=np.zeros_like(compressed), where=energy > 0)

    vectors, chords, adjustments = _templates(key)
    scores = np.hstack([unit @ vectors.T + adjustments, np.full((len(unit), 1), NO_CHORD_SCORE)])
    silent = energy[:, 0] <= 0
    scores[silent, :-1] = 0.0
    scores[silent, -1] = 1.0

    names = FLATS if key is None or key.uses_flats else SHARPS
    path = _best_path(scores)
    spans: list[dict[str, Any]] = []
    i = 0
    while i < len(path):
        j = i
        while j + 1 < len(path) and path[j + 1] == path[i]:
            j += 1
        state = int(path[i])
        if state < len(chords):
            root, suffix, tones = chords[state]
            start, stop = float(edges[i]), float(edges[j + 1])
            bass = _bass(pitched, start, stop)
            slash = bass is not None and bass != root and bass in tones
            label = names[root] + suffix + (f"/{names[bass]}" if slash else "")
            spans.append(
                {
                    "start": round(start, 3),
                    "end": round(stop, 3),
                    "root": names[root],
                    "quality": suffix,
                    "bass": names[bass] if slash else None,
                    "label": label,
                }
            )
        i = j + 1
    return spans


def key_json(key: Key | None) -> dict[str, Any] | None:
    if key is None:
        return None
    return {
        "tonic": key.tonic,
        "mode": key.mode,
        "label": key.label,
        "confidence": key.confidence,
        "scale": sorted(key.scale),
    }


def analyze(
    notes: Sequence[Any], grid: dict[str, Any] | None, chosen: Key | None = None
) -> dict[str, Any]:
    """The detected key, the key in use, and the chords named with the one in use."""
    detected = detect_key(notes)
    key = chosen or detected
    return {
        "key": key_json(key),
        "detected": key_json(detected),
        "chords": detect_chords(notes, grid, key),
    }
