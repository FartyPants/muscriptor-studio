"""The Studio server: upstream's app plus `/studio`, with upstream untouched."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from muscriptor.server import create_app
from studio.models import (
    ModelBusyError,
    ModelLoadError,
    ModelMissingError,
    SwitchableModel,
)

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
) -> FastAPI:
    # web_dir=None: upstream mounts "/" last, which would swallow anything
    # added after it. It is mounted below instead, once Studio's routes exist.
    app = create_app(holder, web_dir=None)
    app.add_middleware(TranscribeGuard, holder=holder)

    api = APIRouter(prefix="/studio/api")

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

    app.include_router(api)

    studio_dir = studio_web or (STUDIO_WEB if STUDIO_WEB.is_dir() else PLACEHOLDER)
    app.mount("/studio", StaticFiles(directory=studio_dir, html=True), name="studio")
    if original_web is not None and Path(original_web).is_dir():
        app.mount("/", StaticFiles(directory=original_web, html=True), name="web")
    return app
