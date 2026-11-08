import io
import json
import os
import time

import numpy as np
import pytest
import soundfile as sf
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


def test_lists_newest_first_without_notes(client):
    first = create(client, name="one.mp3")
    second = create(client, name="two.mp3")
    second["notes"] = NOTES
    client.put(f"/studio/api/projects/{second['id']}", json=second)
    rows = client.get("/studio/api/projects").json()
    assert [r["name"] for r in rows] == ["two", "one"]
    assert rows[0]["note_count"] == 2
    assert "notes" not in rows[0]
    assert first["id"] == rows[1]["id"]


def test_lists_nothing_when_empty(client):
    assert client.get("/studio/api/projects").json() == []


def test_unknown_id_raises(store):
    with pytest.raises(ProjectNotFoundError):
        store.get("f" * 32)


def wav(seconds=2.0, rate=8000):
    buffer = io.BytesIO()
    sf.write(buffer, np.zeros(int(seconds * rate)), rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def row(client, project_id):
    return next(r for r in client.get("/studio/api/projects").json() if r["id"] == project_id)


class TestLength:
    def test_a_listed_project_has_its_length_and_size(self, client):
        body = wav(2.0)
        doc = create(client, "a.wav", body)
        listed = row(client, doc["id"])
        assert listed["duration"] == pytest.approx(2.0)
        assert listed["audio_size"] == len(body)

    def test_unreadable_audio_lists_without_a_length(self, client):
        doc = create(client, "a.mp3", b"not audio")
        listed = row(client, doc["id"])
        assert listed["duration"] is None
        assert listed["audio_size"] == 9

    def test_an_older_project_is_measured_once(self, client, tmp_path, monkeypatch):
        doc = create(client, "a.wav", wav())
        file = tmp_path / "projects" / doc["id"] / "project.json"
        saved = json.loads(file.read_text(encoding="utf-8"))
        del saved["duration"]
        file.write_text(json.dumps(saved), encoding="utf-8")

        calls = []
        real = sf.info
        monkeypatch.setattr("studio.projects.sf.info", lambda p: calls.append(p) or real(p))
        assert row(client, doc["id"])["duration"] == pytest.approx(2.0)
        row(client, doc["id"])
        fetched = client.get(f"/studio/api/projects/{doc['id']}").json()
        client.put(f"/studio/api/projects/{doc['id']}", json=fetched)
        row(client, doc["id"])
        assert len(calls) == 1

    def test_a_put_from_an_older_page_keeps_the_length_and_last_opened(self, client):
        doc = create(client, "a.wav", wav())
        client.post(f"/studio/api/projects/{doc['id']}/opened")
        opened = client.get(f"/studio/api/projects/{doc['id']}").json()["opened"]
        stale = {**doc, "opened": 1.0}
        del stale["duration"]
        saved = client.put(f"/studio/api/projects/{doc['id']}", json=stale).json()
        assert saved["opened"] == opened
        assert saved["duration"] == pytest.approx(2.0)

    def test_a_put_works_before_an_older_project_is_measured(self, client, tmp_path):
        doc = create(client, "a.wav", wav())
        file = tmp_path / "projects" / doc["id"] / "project.json"
        saved = json.loads(file.read_text(encoding="utf-8"))
        del saved["duration"]
        file.write_text(json.dumps(saved), encoding="utf-8")
        assert client.put(f"/studio/api/projects/{doc['id']}", json=saved).status_code == 200


class TestOpened:
    def test_opening_changes_last_opened_and_not_updated(self, client):
        doc = create(client)
        before = client.get(f"/studio/api/projects/{doc['id']}").json()
        time.sleep(0.01)
        assert client.post(f"/studio/api/projects/{doc['id']}/opened").status_code == 204
        after = client.get(f"/studio/api/projects/{doc['id']}").json()
        assert after["opened"] > before["opened"]
        assert after["updated"] == before["updated"]

    def test_an_unknown_project_is_404(self, client):
        assert client.post(f"/studio/api/projects/{'a' * 32}/opened").status_code == 404


class TestDelete:
    def test_removes_the_project_and_its_audio(self, client, tmp_path):
        doc = create(client)
        assert client.delete(f"/studio/api/projects/{doc['id']}").status_code == 204
        assert client.get(f"/studio/api/projects/{doc['id']}").status_code == 404
        assert client.get("/studio/api/projects").json() == []
        assert not (tmp_path / "projects" / doc["id"]).exists()
        assert not (tmp_path / "trash" / doc["id"]).exists()

    @pytest.mark.parametrize("bad", ["a" * 32, "../projects", "..%2f"])
    def test_a_bad_id_is_404(self, client, bad):
        assert client.delete(f"/studio/api/projects/{bad}").status_code in (404, 405)

    def test_files_in_use_lose_nothing(self, client, tmp_path, monkeypatch):
        doc = create(client)

        def refuse(a, b):
            raise PermissionError("in use")

        monkeypatch.setattr("studio.projects.os.replace", refuse)
        r = client.delete(f"/studio/api/projects/{doc['id']}")
        assert r.status_code == 409
        assert "in use" in r.json()["detail"]
        monkeypatch.undo()
        assert client.get(f"/studio/api/projects/{doc['id']}").status_code == 200
        assert (tmp_path / "projects" / doc["id"] / doc["audio_file"]).is_file()

    def test_a_leftover_in_the_trash_is_never_listed(self, client, tmp_path):
        doc = create(client)
        leftover = tmp_path / "trash" / doc["id"]
        leftover.mkdir(parents=True)
        (leftover / "project.json").write_text("{}", encoding="utf-8")
        assert [r["id"] for r in client.get("/studio/api/projects").json()] == [doc["id"]]
        assert client.delete(f"/studio/api/projects/{doc['id']}").status_code == 204
        assert client.get("/studio/api/projects").json() == []

