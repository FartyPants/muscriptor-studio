"""The Studio server: upstream's app plus `/studio`, with upstream untouched."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from muscriptor.server import create_app
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


class TranscribeGuard:
    """Counts transcribe requests so a model switch can't run under one.

    Pure ASGI on purpose: `BaseHTTPMiddleware` buffers streaming responses and
    would hold back the `/transcribe` event feed.
    """

    def __init__(self, app, holder: SwitchableModel) -> None:
        self.app = app
        self.holder = holder

    async def __call__(self, scope, receive, send) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"] not in TRANSCRIBE_PATHS
        ):
            await self.app(scope, receive, send)
            return
        refused = self.holder.try_enter_request()
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
            self.holder.leave_request()


class ModelChoice(BaseModel):
    size: str


def create_studio_app(
    holder: SwitchableModel,
    original_web: Path | None = ORIGINAL_WEB,
    studio_web: Path | None = None,
    data_dir: Path = DATA_DIR,
) -> FastAPI:
    # web_dir=None: upstream mounts "/" last, which would swallow anything
    # added after it. It is mounted below instead, once Studio's routes exist.
    app = create_app(holder, web_dir=None)
    app.add_middleware(TranscribeGuard, holder=holder)

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
