"""The Studio server: upstream's app plus `/studio`, with upstream untouched."""

from __future__ import annotations

import asyncio
import io
import json
import re
import tempfile
import wave
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any, Literal

import numpy as np
import soundfile as sf
from fastapi import APIRouter, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from muscriptor.server import ExportRequest, create_app, export_events
from muscriptor.utils.beats import BeatGrid
from muscriptor.utils.midi import ExportOptions, Timeline, nearest, resolve_grid, timeline_for
from muscriptor.utils.sheets import MuseScoreError, MuseScoreNotFoundError
from muscriptor.utils.audio import _read_non_wav_file, _read_wav_file
from studio.analysis import Key, analyze
from studio.engrave import score_measures, write_musicxml, write_score
from studio.tab import Fretboard
from studio.instruments import scan_instruments
from studio.models import (
    ModelBusyError,
    ModelLoadError,
    ModelMissingError,
    SwitchableModel,
)
from studio.tagger import safe_tag
from studio.projects import DATA_DIR, ProjectNotFoundError, ProjectStore

HERE = Path(__file__).resolve().parent
ORIGINAL_WEB = HERE.parent / "muscriptor" / "web_dist"
STUDIO_WEB = HERE / "web_dist"
PLACEHOLDER = HERE / "placeholder"

TRANSCRIBE_PATHS = ("/transcribe", "/transcribe/midi")
SCORE_SUBDIVISION = 4
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


class StudioFiles(StaticFiles):
    """Static files, with the page always checked for a newer build.

    Build outputs have hashed names, so they can be cached for good. The page
    naming them can't: without this header a browser may reuse an old page, and
    with it the old interface, after an update.
    """

    def file_response(self, full_path, *args, **kwargs):
        response = super().file_response(full_path, *args, **kwargs)
        if str(full_path).endswith(".html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


class ModelChoice(BaseModel):
    size: str


class Onsets(BaseModel):
    onsets: list[float]


class AnalysisNote(BaseModel):
    instrument: str
    pitch: int
    start: float
    end: float


class ChosenKey(BaseModel):
    tonic: int = Field(ge=0, le=11)
    mode: Literal["major", "minor"]

    def as_key(self) -> Key:
        return Key(tonic=self.tonic, mode=self.mode, confidence=1.0)


class AnalysisRequest(BaseModel):
    """Notes in streamed time, as a project stores them."""

    notes: list[AnalysisNote]
    beat_grid: dict[str, Any] | None = None
    key: ChosenKey | None = None


class ScoreRequest(ExportRequest):
    """`/export`'s request, plus what the score needs."""

    key: ChosenKey | None = None
    chords: bool = True
    page: Literal["a4", "letter"] = "letter"
    fretboard: Fretboard | None = None


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
    tagger: Callable[[Any, int], list[dict[str, Any]]] | None = safe_tag,
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
        chosen = body.key.as_key() if body.key else None
        return await asyncio.to_thread(analyze, shown, body.beat_grid, chosen)

    def score_inputs(body: ScoreRequest) -> tuple[BeatGrid | None, ExportOptions]:
        grid = None
        if body.beat_grid is not None:
            fields = body.beat_grid.model_dump()
            beats = fields.pop("beats")
            grid = BeatGrid(**fields, beats=None if beats is None else np.asarray(beats))
        options = body.options.model_dump()
        # Bar lines and note values need a grid to sit on. Upstream skips
        # quantizing when no subdivision was measured, which would let MuseScore
        # pick its own meter, so sheet music falls back to sixteenths.
        options["quantize"] = grid is not None
        if grid is not None and not options["subdivision"] and not grid.beat_subdivision:
            options["subdivision"] = SCORE_SUBDIVISION
        return grid, ExportOptions(**options)

    def score_midi(body: ScoreRequest) -> bytes:
        grid, options = score_inputs(body)
        return holder.events_to_midi_bytes(
            iter(export_events(body.notes)), beat_grid=grid, export=options
        )

    def transport_seconds(body: ScoreRequest, beats: list[float]) -> list[float]:
        """Where each of `beats`, counted from the MIDI's start, plays on the transport.

        The same timeline the MIDI is written with (see upstream `notes_to_midi`),
        which already works in transport time: stored times less the onset delay.
        """
        grid, options = score_inputs(body)
        onsets = [n.start for n in body.notes]
        resolved = resolve_grid(grid, options, onsets)
        delay = resolved.onset_delay
        earliest = min([-delay] + [t - delay for t in onsets])
        timeline = timeline_for(resolved, earliest)
        if not resolved.steady:
            # The MIDI's tempo map follows smoothed, simplified beats, which can be
            # 0.1 s off the tracked ones. Notes still quantize into the same
            # measures, so time the measures by the tracked beats, as the roll
            # draws its bars and as the recording plays.
            raw = body.beat_grid.beats if body.beat_grid else None
            written = resolved.beats
            downbeat = nearest(written, resolved.first_downbeat)
            shift = round(float(timeline.beats_at(resolved.first_downbeat)))
            # Smoothing keeps one beat per tracked beat, so the indexes match.
            same = raw is not None and options.beat_scale == 1 and len(raw) == len(written)
            tracked = np.asarray(raw, dtype=float) if same else written
            timeline = Timeline(tracked, np.arange(len(tracked)) - downbeat + shift)
        return [round(float(timeline.seconds_at(b)), 4) for b in beats]

    @api.post("/score/musicxml")
    async def score_musicxml(body: ScoreRequest):
        """MusicXML from the current notes, with key and chords."""

        def build() -> bytes:
            with tempfile.TemporaryDirectory(prefix="studio-score-") as tmp:
                out = Path(tmp) / "score.musicxml"
                write_musicxml(
                    score_midi(body),
                    out,
                    body.beat_grid is not None,
                    body.key.as_key() if body.key else None,
                    body.chords,
                    body.fretboard,
                )
                return out.read_bytes()

        try:
            data = await asyncio.to_thread(build)
        except MuseScoreNotFoundError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        except MuseScoreError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return Response(content=data, media_type="application/vnd.recordare.musicxml+xml")

    @api.post("/score/view")
    async def score_view(body: ScoreRequest):
        """The MusicXML for the Score tab, and where each measure plays."""
        # Measure 1 must start where the MIDI does, at the recording's start.
        body = body.model_copy(
            update={"options": body.options.model_copy(update={"trim_leading_bars": False})}
        )

        def build() -> dict[str, Any]:
            with tempfile.TemporaryDirectory(prefix="studio-score-") as tmp:
                out = Path(tmp) / "score.musicxml"
                info = write_musicxml(
                    score_midi(body),
                    out,
                    body.beat_grid is not None,
                    body.key.as_key() if body.key else None,
                    body.chords,
                    body.fretboard,
                ) or {}
                starts, end = score_measures(out)
                xml = out.read_text(encoding="utf-8")
            times = transport_seconds(body, starts + [end])
            return {
                "musicxml": xml,
                "measures": times[:-1],
                "end": times[-1],
                "key": info.get("key"),
                "chords": info.get("chords", 0),
                "tab": info.get("tab"),
            }

        try:
            return await asyncio.to_thread(build)
        except MuseScoreNotFoundError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        except MuseScoreError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    @api.post("/score/pdf")
    async def score_pdf(body: ScoreRequest):
        """Every sheet music file, in one zip."""

        def build() -> bytes:
            with tempfile.TemporaryDirectory(prefix="studio-score-") as tmp:
                written = write_score(
                    score_midi(body),
                    Path(tmp),
                    body.beat_grid is not None,
                    body.key.as_key() if body.key else None,
                    body.chords,
                    body.page,
                )
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
                    for path in written:
                        archive.write(path, arcname=path.name)
                return buffer.getvalue()

        try:
            data = await asyncio.to_thread(build)
        except MuseScoreNotFoundError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e
        except MuseScoreError as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return Response(content=data, media_type="application/zip")

    @api.get("/projects/{project_id}/audio-range")
    async def audio_range(project_id: str, start: float, end: float):
        """A slice of a project's audio as WAV, for re-transcribing part of it."""
        if end <= start or start < 0:
            raise HTTPException(status_code=400, detail="choose a range with a start before its end")

        def cut() -> bytes:
            path, _ = store.audio_path(project_id)
            wav, rate = read_audio(path)
            data = np.asarray(wav, dtype=np.float32)
            piece = data[..., int(start * rate) : int(end * rate)]
            buffer = io.BytesIO()
            sf.write(buffer, piece.T if piece.ndim > 1 else piece, rate, format="WAV", subtype="FLOAT")
            return buffer.getvalue()

        try:
            return Response(content=await asyncio.to_thread(cut), media_type="audio/wav")
        except ProjectNotFoundError as e:
            raise HTTPException(status_code=404, detail="no such project") from e

    @api.post("/projects")
    async def create_project(
        file: Annotated[UploadFile, File()],
        model: Annotated[str | None, Form()] = None,
    ):
        name = file.filename or "audio"
        return await asyncio.to_thread(store.create, name, file.file, model=model)

    @api.get("/projects")
    async def list_projects():
        return await asyncio.to_thread(store.list)

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
                for event in scan_instruments(holder, wav, sample_rate, tagger):
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
    app.mount("/studio", StudioFiles(directory=studio_dir, html=True), name="studio")
    if original_web is not None and Path(original_web).is_dir():
        app.mount("/", StaticFiles(directory=original_web, html=True), name="web")
    return app
