import io
import threading
import time
import wave

import httpx
import numpy as np
import pytest
import uvicorn
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from muscriptor.events import NoteStartEvent
from muscriptor.utils.beats import BeatGrid
from studio.app import TranscribeGuard, create_studio_app
from studio.models import SwitchableModel, make_exporter


def wav_bytes() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\0\0" * 1600)
    return buf.getvalue()


class SlowModel:
    """Yields notes with a gap, so streaming can be told from buffering."""

    gap = 0.4

    def transcribe(self, *args, **kwargs):
        for i in range(3):
            yield NoteStartEvent(
                pitch=60, start_time=float(i), index=i, instrument="acoustic_piano"
            )
            time.sleep(self.gap)

    def detect_beat_grid_for(self, *args, **kwargs):
        return None


@pytest.fixture(scope="module")
def exporter():
    return make_exporter()


@pytest.fixture
def weights(tmp_path):
    paths = {"large": tmp_path / "large", "medium": tmp_path / "medium"}
    for p in paths.values():
        p.write_bytes(b"x")
    return paths


def holder_for(weights, exporter, model=None):
    return SwitchableModel(
        loader=lambda size, device: model or SlowModel(),
        free=lambda: None,
        exporter=exporter,
        weights=weights,
    )


@pytest.fixture
def site(tmp_path):
    original = tmp_path / "original"
    original.mkdir()
    (original / "index.html").write_text("original-ui")
    studio = tmp_path / "studio_web"
    studio.mkdir()
    (studio / "index.html").write_text("studio-ui")
    return original, studio


def client(holder, site):
    return TestClient(create_studio_app(holder, site[0], site[1]))


def test_both_interfaces_are_served(weights, exporter, site):
    c = client(holder_for(weights, exporter), site)
    assert c.get("/").text == "original-ui"
    assert c.get("/studio/").text == "studio-ui"
    assert c.get("/studio").text == "studio-ui"
    assert c.get("/health").json() == {"status": "ok"}


def test_export_works_without_a_model(weights, exporter, site):
    c = client(holder_for(weights, exporter), site)
    r = c.post(
        "/export",
        json={"notes": [{"instrument": "acoustic_piano", "pitch": 60, "start": 0, "end": 1}]},
    )
    assert r.status_code == 200
    assert r.content[:4] == b"MThd"


def test_models_endpoint_and_switch(weights, exporter, site):
    h = holder_for(weights, exporter)
    c = client(h, site)
    assert c.get("/studio/api/models").json()["active"] is None
    assert c.post("/studio/api/model", json={"size": "medium"}).json() == {"active": "medium"}
    listed = c.get("/studio/api/models").json()
    assert listed["active"] == "medium"
    assert [m["size"] for m in listed["models"]] == ["large", "medium"]


def test_unknown_or_missing_model_is_404(weights, exporter, site):
    weights["medium"].unlink()
    c = client(holder_for(weights, exporter), site)
    assert c.post("/studio/api/model", json={"size": "medium"}).status_code == 404
    assert c.post("/studio/api/model", json={"size": "huge"}).status_code == 404


def test_switch_during_a_request_is_409(weights, exporter, site):
    h = holder_for(weights, exporter)
    c = client(h, site)
    h.load("large")
    assert h.try_enter_request() is None
    assert c.post("/studio/api/model", json={"size": "medium"}).status_code == 409
    h.leave_request()


@pytest.mark.parametrize("path", ["/transcribe", "/transcribe/midi"])
def test_transcribing_without_a_model_is_503(weights, exporter, site, path):
    c = client(holder_for(weights, exporter), site)
    r = c.post(path, files={"file": ("a.wav", wav_bytes())})
    assert r.status_code == 503
    assert r.json() == {"detail": "no model loaded"}


def test_guard_is_pure_asgi():
    assert not issubclass(TranscribeGuard, BaseHTTPMiddleware)


def test_events_stream_live_and_busy_clears(weights, exporter, site):
    h = holder_for(weights, exporter)
    h.load("large")
    config = uvicorn.Config(
        create_studio_app(h, site[0], site[1]), port=18731, log_level="warning"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)
    try:
        arrivals = []
        with httpx.stream(
            "POST",
            "http://127.0.0.1:18731/transcribe",
            files={"file": ("a.wav", wav_bytes())},
            timeout=10,
        ) as r:
            assert r.status_code == 200
            for chunk in r.iter_raw():
                if b'"start"' in chunk:
                    arrivals.append(time.monotonic())
                    if len(arrivals) == 1:
                        assert h.busy
        assert len(arrivals) == 3
        # Buffering would deliver all three at once at the end.
        assert arrivals[1] - arrivals[0] > SlowModel.gap / 2
        for _ in range(50):
            if not h.busy:
                break
            time.sleep(0.02)
        assert not h.busy
    finally:
        server.should_exit = True
        thread.join(timeout=5)


class GridExporter:
    """Stands in for the weightless exporter's beat tracking."""

    def __init__(self, grid):
        self.grid = grid
        self.seen = None

    def detect_beat_grid_for(self, audio, mode):
        self.seen = (audio, mode)
        return self.grid


def test_beat_grid_for_a_stopped_transcription(weights, site, tmp_path):
    grid = BeatGrid(bpm=120.0, beats_per_bar=4, first_downbeat=0.5, beats=np.arange(0.5, 60, 0.5))
    exporter = GridExporter(grid)
    holder = SwitchableModel(
        loader=lambda s, d: None, free=lambda: None, exporter=exporter, weights=weights
    )
    c = TestClient(create_studio_app(holder, site[0], site[1], data_dir=tmp_path))
    pid = c.post("/studio/api/projects", files={"file": ("a.wav", wav_bytes())}).json()["id"]

    onsets = [0.5 + 0.03 + 0.5 * i for i in range(100)]
    got = c.post(f"/studio/api/projects/{pid}/beat-grid", json={"onsets": onsets}).json()["beat_grid"]

    assert exporter.seen[1] == "best-effort"
    assert got["bpm"] == 120.0
    assert got["beats_per_bar"] == 4
    assert got["onset_delay"] == pytest.approx(0.03, abs=0.01)
    assert len(got["beats"]) == 119


def test_beat_grid_is_null_when_none_is_found(weights, site, tmp_path):
    holder = SwitchableModel(
        loader=lambda s, d: None, free=lambda: None, exporter=GridExporter(None), weights=weights
    )
    c = TestClient(create_studio_app(holder, site[0], site[1], data_dir=tmp_path))
    pid = c.post("/studio/api/projects", files={"file": ("a.wav", wav_bytes())}).json()["id"]
    r = c.post(f"/studio/api/projects/{pid}/beat-grid", json={"onsets": []})
    assert r.json() == {"beat_grid": None}
    missing = c.post(f"/studio/api/projects/{'0' * 32}/beat-grid", json={"onsets": []})
    assert missing.status_code == 404
