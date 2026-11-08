"""Saved projects: one folder per project, `project.json` beside the audio."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, BinaryIO

import soundfile as sf

DATA_DIR = Path(__file__).resolve().parent / "data"

_ID = re.compile(r"[0-9a-f]{32}")
_SUFFIX = re.compile(r"\.[a-z0-9]{1,8}")
# Set by the server. A PUT can't change them.
_SERVER_FIELDS = ("id", "created", "audio_name", "audio_file", "opened", "duration")


class ProjectNotFoundError(KeyError):
    pass


class ProjectInUseError(RuntimeError):
    """The project's files can't be moved, so it was left as it was."""


def _audio_length(path: Path) -> float | None:
    """Seconds of audio in `path`, or None for a file that can't be read.

    Slow for an MP3, up to seconds, so the result is kept in `project.json`.
    """
    try:
        return round(float(sf.info(str(path)).duration), 3)
    except Exception:  # noqa: BLE001 - any file at all can be uploaded
        return None


class ProjectStore:
    def __init__(self, root: Path = DATA_DIR) -> None:
        self.root = Path(root) / "projects"
        self._lock = threading.Lock()

    def _dir(self, project_id: str) -> Path:
        # Ids come from URLs: only ever build paths from the server's own form.
        if not _ID.fullmatch(project_id):
            raise ProjectNotFoundError(project_id)
        path = self.root / project_id
        if not (path / "project.json").is_file():
            raise ProjectNotFoundError(project_id)
        return path

    def create(self, filename: str, audio: BinaryIO, **fields: Any) -> dict[str, Any]:
        project_id = uuid.uuid4().hex
        suffix = Path(filename).suffix.lower()
        suffix = suffix if _SUFFIX.fullmatch(suffix) else ".bin"
        path = self.root / project_id
        path.mkdir(parents=True)
        audio_file = f"audio{suffix}"
        with open(path / audio_file, "wb") as out:
            while chunk := audio.read(1024 * 1024):
                out.write(chunk)
        now = time.time()
        doc = {
            "name": Path(filename).stem,
            "status": "created",
            "notes": [],
            "beat_grid": None,
            "opened": now,
            **fields,
            "id": project_id,
            "created": now,
            "updated": now,
            "audio_name": filename,
            "audio_file": audio_file,
            "duration": _audio_length(path / audio_file),
        }
        self._write(path, doc)
        return doc

    def get(self, project_id: str) -> dict[str, Any]:
        path = self._dir(project_id)
        return json.loads((path / "project.json").read_text(encoding="utf-8"))

    def list(self) -> list[dict[str, Any]]:
        """Every project, newest change first, without its notes."""
        rows = []
        if self.root.is_dir():
            for path in self.root.glob("*/project.json"):
                try:
                    doc = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if "duration" not in doc:
                    doc["duration"] = self._store_length(path.parent, doc)
                notes = doc.pop("notes", [])
                doc.pop("beat_grid", None)
                rows.append({**doc, "note_count": len(notes), "audio_size": self._size(path.parent, doc)})
        return sorted(rows, key=lambda d: -d.get("updated", 0))

    def _store_length(self, path: Path, doc: dict[str, Any]) -> float | None:
        """Read an older project's audio length, once, and keep it."""
        length = _audio_length(path / doc.get("audio_file", ""))
        # Outside the lock: an MP3 can take seconds to measure.
        with self._lock:
            current = json.loads((path / "project.json").read_text(encoding="utf-8"))
            current["duration"] = length
            self._write_unlocked(path, current)
        return length

    @staticmethod
    def _size(path: Path, doc: dict[str, Any]) -> int:
        try:
            return (path / doc.get("audio_file", "")).stat().st_size
        except OSError:
            return 0

    def put(self, project_id: str, doc: dict[str, Any]) -> dict[str, Any]:
        path = self._dir(project_id)
        with self._lock:
            current = json.loads((path / "project.json").read_text(encoding="utf-8"))
            merged = {
                **{k: v for k, v in doc.items() if k not in _SERVER_FIELDS},
                # Not every field is in an older project yet.
                **{k: current[k] for k in _SERVER_FIELDS if k in current},
                "updated": time.time(),
            }
            self._write_unlocked(path, merged)
        return merged

    def mark_opened(self, project_id: str) -> None:
        """Note that the project was opened. Opening isn't a change to it."""
        path = self._dir(project_id)
        with self._lock:
            current = json.loads((path / "project.json").read_text(encoding="utf-8"))
            current["opened"] = time.time()
            self._write_unlocked(path, current)

    def delete(self, project_id: str) -> None:
        """Remove the project and its audio.

        The folder is moved out in one step first, so a file in use can only
        stop the whole delete, never leave half a project.
        """
        path = self._dir(project_id)
        trash = self.root.parent / "trash"
        trash.mkdir(parents=True, exist_ok=True)
        target = trash / project_id
        with self._lock:
            shutil.rmtree(target, ignore_errors=True)
            try:
                os.replace(path, target)
            except OSError as e:
                raise ProjectInUseError(
                    "Its files are in use. Close any other Studio tab playing it, then try again."
                ) from e
        shutil.rmtree(target, ignore_errors=True)

    def audio_path(self, project_id: str) -> tuple[Path, str]:
        path = self._dir(project_id)
        doc = self.get(project_id)
        audio = path / doc["audio_file"]
        media_type = mimetypes.guess_type(audio.name)[0] or "application/octet-stream"
        return audio, media_type

    def _write(self, path: Path, doc: dict[str, Any]) -> None:
        with self._lock:
            self._write_unlocked(path, doc)

    @staticmethod
    def _write_unlocked(path: Path, doc: dict[str, Any]) -> None:
        # Temp file first: a crash mid-write must not damage the saved project.
        fd, tmp = tempfile.mkstemp(dir=path, prefix="project-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump(doc, out, ensure_ascii=False)
            os.replace(tmp, path / "project.json")
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
