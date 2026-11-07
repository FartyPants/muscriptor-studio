from pathlib import Path

import pytest

from studio.models import (
    ModelBusyError,
    ModelLoadError,
    ModelMissingError,
    NoModelLoadedError,
    SwitchableModel,
)


class FakeModel:
    def __init__(self, size):
        self.size = size

    def transcribe(self, *args, **kwargs):
        yield "a"
        yield "b"

    def transcribe_and_postprocess(self, *args, **kwargs):
        return self.size


class FakeExporter:
    def events_to_midi_bytes(self, *args, **kwargs):
        return b"midi"


@pytest.fixture
def weights(tmp_path: Path):
    paths = {"large": tmp_path / "large", "medium": tmp_path / "medium"}
    for p in paths.values():
        p.write_bytes(b"x")
    return paths


def make(weights, calls=None, fail=()):
    calls = [] if calls is None else calls

    def loader(size, device):
        calls.append(f"load {size}")
        if size in fail:
            raise OSError("corrupt")
        return FakeModel(size)

    return SwitchableModel(
        loader=loader,
        free=lambda: calls.append("free"),
        exporter=FakeExporter(),
        weights=weights,
    )


def test_old_model_is_freed_before_the_new_one_loads(weights):
    calls = []
    h = make(weights, calls)
    h.load("large")
    calls.clear()
    h.load("medium")
    assert calls == ["free", "load medium"]
    assert h.active == "medium"


def test_reloading_the_active_model_does_nothing(weights):
    calls = []
    h = make(weights, calls)
    h.load("large")
    calls.clear()
    h.load("large")
    assert calls == []


def test_missing_weights_keep_the_current_model(weights):
    h = make(weights)
    h.load("large")
    weights["medium"].unlink()
    with pytest.raises(ModelMissingError):
        h.load("medium")
    assert h.active == "large"
    assert list(h.transcribe()) == ["a", "b"]


def test_failed_load_restores_the_previous_model(weights):
    h = make(weights, fail={"medium"})
    h.load("large")
    with pytest.raises(ModelLoadError):
        h.load("medium")
    assert h.active == "large"
    assert not h.switching
    assert list(h.transcribe()) == ["a", "b"]


def test_switch_is_refused_during_a_request(weights):
    h = make(weights)
    h.load("large")
    assert h.try_enter_request() is None
    with pytest.raises(ModelBusyError):
        h.load("medium")
    h.leave_request()
    h.load("medium")
    assert h.active == "medium"


def test_switch_is_refused_while_a_generator_is_open(weights):
    h = make(weights)
    h.load("large")
    run = h.transcribe()
    next(run)
    with pytest.raises(ModelBusyError):
        h.load("medium")
    run.close()
    h.load("medium")
    assert h.active == "medium"


def test_requests_are_refused_during_a_switch(weights):
    seen = []

    def loader(size, device):
        seen.append(h.try_enter_request())
        return FakeModel(size)

    h = SwitchableModel(
        loader=loader, free=lambda: None, exporter=FakeExporter(), weights=weights
    )
    h.load("large")
    assert seen == ["switching model"]


def test_no_model_refuses_transcription_but_exports(weights):
    h = make(weights)
    assert h.try_enter_request() == "no model loaded"
    with pytest.raises(NoModelLoadedError):
        list(h.transcribe())
    assert h.events_to_midi_bytes(iter(())) == b"midi"
