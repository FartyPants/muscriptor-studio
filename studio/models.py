"""One model in memory at a time, swappable while the server runs.

`muscriptor.server.create_app` binds a single model for the life of the app, so
Studio hands it a `SwitchableModel` that stands in for a `TranscriptionModel`
and forwards to whichever model is loaded.
"""

from __future__ import annotations

import gc
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# Largest first: the order the UI lists them in.
WEIGHTS: dict[str, Path] = {
    "large": MODELS_DIR / "muscriptor-large.safetensors",
    "medium": MODELS_DIR / "medium" / "model.safetensors",
}


class ModelBusyError(RuntimeError):
    """A transcription is running, or another switch is in progress."""


class ModelMissingError(RuntimeError):
    """The requested weights are not on disk."""


class ModelLoadError(RuntimeError):
    """The requested weights could not be loaded."""


class NoModelLoadedError(RuntimeError):
    """A model method was called while no model is in memory."""


def load_weights(size: str, device: str | None) -> Any:
    from muscriptor.transcription_model import TranscriptionModel

    return TranscriptionModel.load_model(str(WEIGHTS[size]), device=device)


def free_memory() -> None:
    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def make_exporter() -> Any:
    """A `TranscriptionModel` without weights.

    `events_to_midi_bytes` only needs the tokenizer, so MIDI export keeps
    working during a switch and in `--no-model` mode.
    """
    import torch

    from muscriptor.tokenizer.mt3 import MT3Tokenizer
    from muscriptor.transcription_model import TranscriptionModel

    tokenizer = MT3Tokenizer(instrument_vocabulary="MT3_FULL_PLUS", max_shift_steps=1001)
    return TranscriptionModel(model=None, tokenizer=tokenizer, device=torch.device("cpu"))


class SwitchableModel:
    def __init__(
        self,
        device: str | None = None,
        *,
        loader: Callable[[str, str | None], Any] = load_weights,
        free: Callable[[], None] = free_memory,
        exporter: Any = None,
        weights: dict[str, Path] | None = None,
    ) -> None:
        self._device = device
        self._loader = loader
        self._free = free
        self._exporter = make_exporter() if exporter is None else exporter
        self._weights = WEIGHTS if weights is None else weights
        self._model: Any = None
        self._active: str | None = None
        self._switching = False
        self._requests = 0  # transcribe requests between arrival and last byte
        self._runs = 0  # blocking transcriptions, which can outlive their request
        self._state = threading.Lock()

    # ---- state -------------------------------------------------------------

    @property
    def active(self) -> str | None:
        return self._active

    @property
    def switching(self) -> bool:
        return self._switching

    @property
    def busy(self) -> bool:
        return self._switching or self._requests > 0 or self._runs > 0

    def available(self) -> list[dict[str, Any]]:
        return [
            {"size": size, "available": path.is_file(), "active": size == self._active}
            for size, path in self._weights.items()
        ]

    # ---- request tracking (see app.TranscribeGuard) -------------------------

    def try_enter_request(self) -> str | None:
        """Count a transcribe request in, or say why it can't start."""
        with self._state:
            if self._switching:
                return "switching model"
            if self._model is None:
                return "no model loaded"
            self._requests += 1
            return None

    def leave_request(self) -> None:
        with self._state:
            self._requests -= 1

    # ---- switching ----------------------------------------------------------

    def load(self, size: str) -> None:
        """Load the first model, or replace the current one."""
        path = self._weights.get(size)
        if path is None or not path.is_file():
            raise ModelMissingError(f"no weights for model {size!r}")
        with self._state:
            if size == self._active:
                return
            if self._switching:
                raise ModelBusyError("a model is already loading")
            if self.busy:
                raise ModelBusyError("a transcription is running")
            self._switching = True
            previous = self._active
            # Free before loading: two models may not fit in VRAM.
            self._model = None
            self._active = None
        try:
            self._free()
            try:
                model = self._loader(size, self._device)
            except Exception as e:
                self._free()
                if previous is not None:
                    self._model = self._loader(previous, self._device)
                    self._active = previous
                raise ModelLoadError(f"could not load model {size!r}: {e}") from e
            self._model = model
            self._active = size
        finally:
            with self._state:
                self._switching = False

    # ---- the TranscriptionModel surface create_app uses ---------------------

    def _current(self) -> Any:
        model = self._model
        if model is None:
            raise NoModelLoadedError("no model loaded")
        return model

    def transcribe(self, *args: Any, **kwargs: Any) -> Iterator[Any]:
        # Not counted in `_runs`: a client that disconnects leaves this generator
        # abandoned, not closed, so a count could stay up until a garbage
        # collection. The request count covers the run instead, since a streaming
        # response ends only once its worker thread has stopped. `free_memory`
        # collects the abandoned generator, which releases the old model.
        return self._current().transcribe(*args, **kwargs)

    def transcribe_and_postprocess(self, *args: Any, **kwargs: Any) -> Any:
        model = self._current()
        with self._state:
            self._runs += 1
        try:
            return model.transcribe_and_postprocess(*args, **kwargs)
        finally:
            with self._state:
                self._runs -= 1

    def detect_beat_grid_for(self, *args: Any, **kwargs: Any) -> Any:
        # Beat tracking needs no transcription weights.
        return self._exporter.detect_beat_grid_for(*args, **kwargs)

    def events_to_midi_bytes(self, *args: Any, **kwargs: Any) -> bytes:
        return self._exporter.events_to_midi_bytes(*args, **kwargs)
