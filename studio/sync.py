"""Sync data: where each beat of an exported score plays in the recording.

A `.sync.json` beside a MusicXML file, for apps that follow the score along
with the audio. Its format is agreed with MusicLearn: tell that project if the
fields change.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Callable, Sequence
from typing import Any


def build_sync(
    measures: Sequence[float],
    seconds_at: Callable[[list[float]], list[float]],
    end: float,
    timing_source: str,
    score_filename: str,
    score_bytes: bytes,
    audio_filename: str | None = None,
    audio_duration: float | None = None,
) -> dict[str, Any]:
    """The sync document for a score with these `measures` starts, in quarters.

    One anchor per quarter below `end`, and at every measure start, which in a
    meter such as 5/8 needn't be a whole quarter. Seconds can be negative, for
    lead-in bars before the recording starts, and can pass the audio's end:
    a reader needs both, so they are never clamped.
    """
    quarters = sorted({0.0, *map(float, range(math.ceil(end))), *(float(m) for m in measures)})
    quarters = [q for q in quarters if q < end or q == 0.0]
    seconds = seconds_at(quarters)
    audio: dict[str, Any] = {}
    if audio_filename:
        audio["filename"] = audio_filename
    if audio_duration is not None:
        audio["durationSeconds"] = audio_duration
    return {
        "format": "score-audio-sync",
        "version": 1,
        "score": {"filename": score_filename, "sha256": hashlib.sha256(score_bytes).hexdigest()},
        **({"audio": audio} if audio else {}),
        "timingSource": timing_source,
        "anchors": [{"quarter": q, "seconds": s} for q, s in zip(quarters, seconds)],
        "endQuarter": float(end),
        "endSeconds": seconds_at([float(end)])[0],
    }
