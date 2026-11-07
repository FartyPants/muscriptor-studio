"""Saved projects: one folder per project, `project.json` beside the audio."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, BinaryIO

DATA_DIR = Path(__file__).resolve().parent / "data"

_ID = re.compile(r"[0-9a-f]{32}")
_SUFFIX = re.compile(r"\.[a-z0-9]{1,8}")
# Set by the server. A PUT can't change them.
_SERVER_FIELDS = ("id", "created", "audio_name", "audio_file")


class ProjectNotFoundError(KeyError):
    pass


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
        }
        self._write(path, doc)
        return doc

    def get(self, project_id: str) -> dict[str, Any]:
        path = self._dir(project_id)
        return json.loads((path / "project.json").read_text(encoding="utf-8"))

    def put(self, project_id: str, doc: dict[str, Any]) -> dict[str, Any]:
        path = self._dir(project_id)
        with self._lock:
            current = json.loads((path / "project.json").read_text(encoding="utf-8"))
            merged = {
                **doc,
                **{k: current[k] for k in _SERVER_FIELDS},
                "updated": time.time(),
            }
            self._write_unlocked(path, merged)
        return merged

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
