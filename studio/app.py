"""The Studio server: upstream's app plus `/studio`, with upstream untouched."""

from __future__ import annotations

import asyncio
import io
import json
import re
import wave
from pathlib import Path
from typing import Annotated, Any

import numpy as np
from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from muscriptor.server import create_app
from muscriptor.utils.audio import _read_non_wav_file, _read_wav_file
from studio.analysis import analyze
from studio.instruments import scan_instruments
from studio.models import (
    ModelBusyError,
    ModelLoadError,
    ModelMissingError,
    SwitchableModel,
)
from studio.projects import DATA_DIR, ProjectNotFoundError, ProjectStore

HERE = Path(__file__).resolve().parent
ORIGINAL_WEB = HERE.parent / "muscriptor" / "web_dist"
STUDIO_WEB = HERE / "web_dist"
PLACEHOLDER = HERE / "placeholder"

TRANSCRIBE_PATHS = ("/transcribe", "/transcribe/midi")
SCAN_PATH = re.compile(r"/studio/api/projects/[^/]+/detect-instruments")


class TranscribeGuard:
    """Counts transcribe requests so a model switch can't run under one.

    Pure ASGI on purpose: `BaseHTTPMiddleware` buffers streaming responses and
    would hold back the `/transcribe` event feed.
    """

    def __init__(self, app, holder: SwitchableModel, autoload: str | None = None) -> None:
        self.app = app
        self.holder = holder
        self.autoload = autoload

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        if scope["path"] in TRANSCRIBE_PATHS:
            enter, leave = self.holder.try_enter_request, self.holder.leave_request
        elif SCAN_PATH.fullmatch(scope["path"]):
            enter, leave = self.holder.try_enter_scan, self.holder.leave_scan
        else:
            await self.app(scope, receive, send)
            return
        refused = enter()
        if refused == "no model loaded" and self.autoload and scope["path"] in TRANSCRIBE_PATHS:
            try:
                await asyncio.to_thread(self.holder.load, self.autoload)
                refused = enter()
            except (ModelBusyError, ModelLoadError, ModelMissingError) as e:
                refused = str(e)
        if refused is not None:
            body = json.dumps({"detail": refused}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        try:
            await self.app(scope, receive, send)
        finally:
            leave()


class ModelChoice(BaseModel):
    size: str


class Onsets(BaseModel):
    onsets: list[float]


class AnalysisNote(BaseModel):
    instrument: str
    pitch: int
    start: float
    end: float


class AnalysisRequest(BaseModel):
    """Notes in streamed time, as a project stores them."""

    notes: list[AnalysisNote]
    beat_grid: dict[str, Any] | None = None


def read_audio(path: Path):
    """Decode `path` the way `/transcribe` does: WAV first, then anything else."""
    with open(path, "rb") as f:
        data = f.read()
    try:
        return _read_wav_file(io.BytesIO(data))
    except (wave.Error, EOFError):
        return _read_non_wav_file(io.BytesIO(data))


def grid_to_json(grid: Any) -> dict[str, Any]:
    """The fields `/transcribe` sends as `beat_grid`."""
    return {
        "bpm": grid.bpm,
        "beats_per_bar": grid.beats_per_bar,
        "first_downbeat": grid.first_downbeat,
        "onset_delay": grid.onset_delay,
        "beat_subdivision": grid.beat_subdivision,
        "steady": grid.steady,
        "beats": None if grid.beats is None else [round(float(b), 3) for b in np.asarray(grid.beats)],
    }


def create_studio_app(
    holder: SwitchableModel,
    original_web: Path | None = ORIGINAL_WEB,
    studio_web: Path | None = None,
    data_dir: Path = DATA_DIR,
    autoload: str | None = None,
) -> FastAPI:
    # web_dir=None: upstream mounts "/" last, which would swallow anything
    # added after it. It is mounted below instead, once Studio's routes exist.
    app = create_app(holder, web_dir=None)
    app.add_middleware(TranscribeGuard, holder=holder, autoload=autoload)

    api = APIRouter(prefix="/studio/api")
    store = ProjectStore(data_dir)

    @api.get("/models")
    async def list_models():
        return {
            "models": holder.available(),
            "active": holder.active,
            "busy": holder.busy,
            "switching": holder.switching,
        }

    @api.post("/model")
    async def choose_model(choice: ModelChoice):
        try:
            await asyncio.to_thread(holder.load, choice.size)
        except ModelMissingError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e
        except ModelBusyError as e:
            raise HTTPException(status_code=409, detail=str(e)) from e
        except ModelLoadError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return {"active": holder.active}

    @api.post("/analysis")
    async def analysis(body: AnalysisRequest):
        """Key and chords for the notes as they stand. Needs no model."""
        delay = (body.beat_grid or {}).get("onset_delay") or 0.0
        shown = [
            n.model_copy(update={"start": n.start - delay, "end": n.end - delay})
            for n in body.notes
        ]
        return await asyncio.to_thread(analyze, shown, body.beat_grid)

    @api.post("/projects")
    async def create_project(
        file: Annotated[UploadFile, File()],
        model: Annotated[str | None, Form()] = None,
    ):
        name = file.filename or "audio"
        return await asyncio.to_thread(store.create, name, file.file, model=model)

    @api.get("/projects/{project_id}")
    async def get_project(project_id: str):
        try:
            return await asyncio.to_thread(store.get, project_id)
        except ProjectNotFoundError as e:
            raise HTTPException(status_code=404, detail="no such project") from e

    @api.put("/projects/{project_id}")
    async def put_project(project_id: str, doc: dict[str, Any]):
        try:
            return await asyncio.to_thread(store.put, project_id, doc)
        except ProjectNotFoundError as e:
            raise HTTPException(status_code=404, detail="no such project") from e

    @api.get("/projects/{project_id}/audio")
    async def project_audio(project_id: str):
        try:
            path, media_type = await asyncio.to_thread(store.audio_path, project_id)
        except ProjectNotFoundError as e:
            raise HTTPException(status_code=404, detail="no such project") from e
        return FileResponse(path, media_type=media_type)

    @api.post("/projects/{project_id}/beat-grid")
    async def beat_grid(project_id: str, body: Onsets):
        """The grid for a transcription stopped early.

        It normally arrives at the end of `/transcribe`, so a stopped run never
        gets one. `onsets` are the kept notes' streamed start times.
        """

        def detect():
            path, _ = store.audio_path(project_id)
            grid = holder.detect_beat_grid_for(read_audio(path), "best-effort")
            # Always measured: with no onsets it records 0, which /export needs.
            return None if grid is None else grid_to_json(grid.with_onset_delay(body.onsets))

        try:
            return {"beat_grid": await asyncio.to_thread(detect)}
        except ProjectNotFoundError as e:
            raise HTTPException(status_code=404, detail="no such project") from e

    @api.post("/projects/{project_id}/detect-instruments")
    async def detect_instruments(project_id: str):
        """Suggest instruments by transcribing a few passages (see `instruments.py`)."""
        try:
            path, _ = await asyncio.to_thread(store.audio_path, project_id)
        except ProjectNotFoundError as e:
            raise HTTPException(status_code=404, detail="no such project") from e

        def events():
            try:
                wav, sample_rate = read_audio(path)
                for event in scan_instruments(holder, wav, sample_rate):
                    yield f"data: {json.dumps(event)}\n\n"
            except Exception as e:
                # Headers are sent by now, so the stream has to say it failed.
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Last, so a bad API path is a 404 rather than the page from the /studio mount.
    @api.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def unknown_api(rest: str):
        raise HTTPException(status_code=404, detail="not found")

    @app.get("/studio", include_in_schema=False)
    async def studio_root():
        return RedirectResponse("/studio/")

    app.include_router(api)

    studio_dir = studio_web or (STUDIO_WEB if STUDIO_WEB.is_dir() else PLACEHOLDER)
    app.mount("/studio", StaticFiles(directory=studio_dir, html=True), name="studio")
    if original_web is not None and Path(original_web).is_dir():
        app.mount("/", StaticFiles(directory=original_web, html=True), name="web")
    return app
