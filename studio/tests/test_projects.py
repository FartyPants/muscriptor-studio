import io
import json
import os

import pytest
from fastapi.testclient import TestClient

from studio.app import create_studio_app
from studio.models import SwitchableModel
from studio.projects import ProjectNotFoundError, ProjectStore

GRID = {"bpm": 96.5, "beats_per_bar": 3, "first_downbeat": 0.1, "onset_delay": 0.012}
NOTES = [
    {"id": "n1", "instrument": "violin", "pitch": 74, "start": 0.1 + 0.2, "end": 1 / 3},
    {"id": "n2", "instrument": "drums", "pitch": 36, "start": 1.0000000001, "end": 2.5},
]


class NoExport:
    pass


@pytest.fixture
def store(tmp_path):
    return ProjectStore(tmp_path)


@pytest.fixture
def client(tmp_path):
    holder = SwitchableModel(
        loader=lambda s, d: None, free=lambda: None, exporter=NoExport(), weights={}
    )
    return TestClient(create_studio_app(holder, data_dir=tmp_path))


def create(client, name="song.mp3", body=b"\x00\xffaudio"):
    r = client.post(
        "/studio/api/projects",
        files={"file": (name, body)},
        data={"model": "medium"},
    )
    assert r.status_code == 200
    return r.json()


def test_round_trip_keeps_exact_values(client):
    doc = create(client)
    assert doc["model"] == "medium"
    assert doc["name"] == "song"
    doc["notes"] = NOTES
    doc["beat_grid"] = GRID
    doc["status"] = "completed"
    assert client.put(f"/studio/api/projects/{doc['id']}", json=doc).status_code == 200
    back = client.get(f"/studio/api/projects/{doc['id']}").json()
    assert back["notes"] == NOTES
    assert back["beat_grid"] == GRID
    assert back["status"] == "completed"
    assert back["updated"] >= doc["updated"]


def test_audio_bytes_are_preserved(client):
    doc = create(client, body=bytes(range(256)) * 10)
    r = client.get(f"/studio/api/projects/{doc['id']}/audio")
    assert r.content == bytes(range(256)) * 10
    assert r.headers["content-type"].startswith("audio/")


def test_unicode_filename(client):
    doc = create(client, name="09-Kočky.mp3")
    assert doc["name"] == "09-Kočky"
    assert doc["audio_name"] == "09-Kočky.mp3"
    assert client.get(f"/studio/api/projects/{doc['id']}").json()["name"] == "09-Kočky"


def test_server_fields_cannot_be_overwritten(client):
    doc = create(client)
    pid, created = doc["id"], doc["created"]
    doc.update(id="0" * 32, created=1, audio_file="../../evil.py")
    client.put(f"/studio/api/projects/{pid}", json=doc)
    back = client.get(f"/studio/api/projects/{pid}").json()
    assert back["id"] == pid
    assert back["created"] == created
    assert back["audio_file"] == "audio.mp3"


@pytest.mark.parametrize("bad", ["abc", "..%2F..", "%2e%2e", "0" * 32, "A" * 32])
def test_bad_ids_are_404(client, bad):
    assert client.get(f"/studio/api/projects/{bad}").status_code == 404
    assert client.put(f"/studio/api/projects/{bad}", json={}).status_code == 404
    assert client.get(f"/studio/api/projects/{bad}/audio").status_code == 404


def test_odd_suffix_does_not_reach_the_path(store):
    doc = store.create("x.mp3/../../evil", io.BytesIO(b"a"))
    assert doc["audio_file"] == "audio.bin"


def test_failed_write_keeps_the_saved_project(store, monkeypatch):
    doc = store.create("a.wav", io.BytesIO(b"a"))
    doc["notes"] = NOTES
    store.put(doc["id"], doc)

    def boom(*args):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    doc["notes"] = []
    with pytest.raises(OSError):
        store.put(doc["id"], doc)
    monkeypatch.undo()
    assert store.get(doc["id"])["notes"] == NOTES
    folder = store.root / doc["id"]
    assert sorted(p.name for p in folder.iterdir()) == ["audio.wav", "project.json"]


def test_a_truncated_temp_file_is_ignored(store):
    doc = store.create("a.wav", io.BytesIO(b"a"))
    (store.root / doc["id"] / "project-x.tmp").write_text('{"notes": [')
    assert json.loads((store.root / doc["id"] / "project.json").read_text())["id"] == doc["id"]
    assert store.get(doc["id"])["id"] == doc["id"]


def test_unknown_id_raises(store):
    with pytest.raises(ProjectNotFoundError):
        store.get("f" * 32)
