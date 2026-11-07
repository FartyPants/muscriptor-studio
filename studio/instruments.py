"""Find which instruments play, before committing to a full transcription.

The model has no separate instrument detector, so this transcribes a few short
passages and reports what it found. The result is a suggestion for the user to
check: a list given to `/transcribe` is a hard constraint, so an instrument left
off it can't appear.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterator
from typing import Any

import numpy as np

from muscriptor.events import NoteStartEvent

SAMPLES = 8
SAMPLE_SECONDS = 5.0
# One stray note in a passage is more likely a model slip than an instrument.
MIN_NOTES = 2


def pick_windows(
    wav: Any, sample_rate: int, count: int = SAMPLES, seconds: float = SAMPLE_SECONDS
) -> list[tuple[int, int]]:
    """Sample ranges to listen to: the loudest window in each of `count` sections.

    Taking one per section spreads them across the piece, so an instrument that
    only plays in one part still has a chance of being heard. Taking the loudest
    avoids spending a sample on silence.
    """
    samples = np.asarray(wav, dtype=np.float32)
    total = samples.shape[-1]
    size = int(seconds * sample_rate)
    if total <= size:
        return [(0, total)]
    starts = np.arange(0, total - size + 1, size)
    if len(starts) <= count:
        return [(int(s), int(s) + size) for s in starts]
    # Every 16th sample is plenty to compare loudness.
    energy = np.array([float(np.mean(samples[..., s : s + size : 16] ** 2)) for s in starts])
    chosen = [int(part[np.argmax(energy[part])]) for part in np.array_split(np.arange(len(starts)), count)]
    return [(int(starts[i]), int(starts[i]) + size) for i in chosen]


def scan_instruments(
    model: Any,
    wav: Any,
    sample_rate: int,
    tagger: Callable[[Any, int], list[dict[str, Any]]] | None = None,
) -> Iterator[dict[str, Any]]:
    """Yield `heard`, if there is a tagger, then `progress`, then `instruments`.

    The tagger goes first because it takes seconds and the scan takes a minute.
    """
    if tagger is not None:
        yield {"type": "heard", "suggestions": tagger(wav, sample_rate)}
    windows = pick_windows(wav, sample_rate)
    found: Counter[str] = Counter()
    yield {"type": "progress", "completed": 0, "total": len(windows)}
    for done, (start, end) in enumerate(windows, start=1):
        passage = wav[..., start:end]
        for event in model.transcribe((passage, sample_rate), batch_size=1, no_eos_is_ok=True):
            if isinstance(event, NoteStartEvent):
                found[event.instrument] += 1
        yield {"type": "progress", "completed": done, "total": len(windows)}
    yield {
        "type": "instruments",
        "instruments": [
            {"name": name, "notes": notes}
            for name, notes in found.most_common()
            if notes >= MIN_NOTES
        ],
    }
