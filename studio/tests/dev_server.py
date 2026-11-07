"""A Studio server for UI work: no weights, no GPU, repeatable notes.

    python -m studio.tests.dev_server --data-dir <dir> [--notes 300] [--port 8224]

Transcription streams made-up notes, so the whole flow can be driven in a
browser. A fixture project is created at startup and its id is printed.
"""

from __future__ import annotations

import argparse
import io
import math
import random
import struct
import time
import uuid
import wave
from pathlib import Path

import uvicorn

from muscriptor.events import NoteEndEvent, NoteStartEvent, ProgressEvent
from studio.app import create_studio_app
from studio.models import WEIGHTS, SwitchableModel
from studio.projects import ProjectStore

INSTRUMENTS = ["acoustic_guitar", "electric_bass", "violin", "drums"]
BPM = 120.0
BEATS_PER_BAR = 4


def make_wav(seconds: float) -> bytes:
    rate = 16000
    frames = bytearray()
    for i in range(int(seconds * rate)):
        t = i / rate
        beat = t * BPM / 60
        click = math.exp(-20 * (beat % 1)) * 0.5
        frames += struct.pack("<h", int(30000 * click * math.sin(2 * math.pi * 880 * t)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue()


def make_notes(count: int, seconds: float, seed: int = 1) -> list[dict]:
    rng = random.Random(seed)
    notes = []
    for _ in range(count):
        instrument = rng.choice(INSTRUMENTS)
        start = rng.uniform(0, seconds - 1)
        pitch = {"electric_bass": rng.randint(36, 52), "drums": rng.choice([36, 38, 42, 46])}.get(
            instrument, rng.randint(55, 84)
        )
        length = 0.05 if instrument == "drums" else rng.uniform(0.1, 0.8)
        notes.append(
            {
                "id": uuid.uuid4().hex,
                "instrument": instrument,
                "pitch": pitch,
                "start": round(start, 3),
                "end": round(start + length, 3),
            }
        )
    return notes


def beat_grid(seconds: float) -> dict:
    period = 60 / BPM
    return {
        "bpm": BPM,
        "beats_per_bar": BEATS_PER_BAR,
        "first_downbeat": 0.0,
        "onset_delay": 0.02,
        "beat_subdivision": 4,
        "steady": True,
        "beats": [round(i * period, 3) for i in range(int(seconds / period))],
    }


class FakeModel:
    """Streams a chunk of notes every `pace` seconds."""

    pace = 1.0
    chunks = 12

    def transcribe(self, *args, **kwargs):
        notes = sorted(make_notes(240, 60.0, seed=2), key=lambda n: n["start"])
        per_chunk = len(notes) // self.chunks
        yield ProgressEvent(completed=0, total=self.chunks)
        for chunk in range(self.chunks):
            time.sleep(self.pace)
            for i, n in enumerate(notes[chunk * per_chunk : (chunk + 1) * per_chunk]):
                start = NoteStartEvent(
                    pitch=n["pitch"],
                    start_time=n["start"],
                    index=chunk * per_chunk + i,
                    instrument=n["instrument"],
                )
                yield start
                yield NoteEndEvent(end_time=n["end"], start_event=start)
            yield ProgressEvent(completed=chunk + 1, total=self.chunks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--notes", type=int, default=300)
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--port", type=int, default=8224)
    args = parser.parse_args()

    store = ProjectStore(args.data_dir)
    doc = store.create(
        "fixture.wav",
        io.BytesIO(make_wav(args.seconds)),
        model="large",
        status="completed",
        notes=make_notes(args.notes, args.seconds),
        beat_grid=beat_grid(args.seconds),
    )
    print(f"fixture project: {doc['id']}", flush=True)

    holder = SwitchableModel(loader=lambda size, device: FakeModel(), free=lambda: None, weights=WEIGHTS)
    holder.load("large")
    uvicorn.run(
        create_studio_app(holder, data_dir=args.data_dir),
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
