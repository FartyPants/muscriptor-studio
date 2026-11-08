from pathlib import Path

import pytest
from huggingface_hub.errors import GatedRepoError, LocalEntryNotFoundError

from studio import install_models as im
from studio.models import MODELS_DIR, WEIGHTS
from studio.tagger import TAGGER_DIR


class FakeResponse:
    status_code = 403
    headers = {}
    url = "https://huggingface.co/x"
    request = None
    text = ""
    content = b""

    def json(self):
        return {}


def gated():
    try:
        return GatedRepoError("gated", response=FakeResponse())
    except TypeError:  # huggingface_hub versions differ in what the error requires
        return GatedRepoError("gated")


def writer(calls=None, refuse=()):
    """A download that writes the file, or raises for repos in `refuse`."""

    def get(repo, remote, path):
        if repo in refuse:
            raise refuse[repo] if isinstance(refuse, dict) else gated()
        if calls is not None:
            calls.append((repo, remote))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x")

    return get


def run(tmp_path, names, **kw):
    kw.setdefault("get", writer())
    kw.setdefault("present", lambda repo, remote, path: path.is_file())
    kw.setdefault("sign_in", lambda: pytest.fail("should not log in"))
    kw.setdefault("assets", None)
    kw.setdefault("can_ask", False)
    return im.install(names, root=tmp_path, **kw)


def test_files_go_where_studio_looks():
    for name, path in WEIGHTS.items():
        locals_ = [MODELS_DIR / local for _, local in im.MODELS[name].files]
        assert path in locals_, name
    tagger = {MODELS_DIR / local for _, local in im.MODELS["tagger"].files}
    assert tagger == {TAGGER_DIR / "config.json", TAGGER_DIR / "model.safetensors", TAGGER_DIR / "preprocessor_config.json"}


def test_downloads_each_file_to_its_place(tmp_path):
    assert run(tmp_path, ["small", "large"]) == 0
    assert (tmp_path / "small" / "model.safetensors").is_file()
    assert (tmp_path / "small" / "config.json").is_file()
    assert (tmp_path / "muscriptor-large.safetensors").is_file()
    assert (tmp_path / "config.json").is_file()


def test_a_repeat_run_downloads_nothing(tmp_path, capsys):
    run(tmp_path, ["small"])
    calls = []
    assert run(tmp_path, ["small"], get=writer(calls)) == 0
    assert calls == []
    assert "already there" in capsys.readouterr().out


def test_without_a_login_it_says_what_to_do_and_carries_on(tmp_path, capsys):
    refuse = {"MuScriptor/muscriptor-small": gated()}
    assert run(tmp_path, ["small", "tagger"], get=writer(refuse=refuse)) == 1
    out = capsys.readouterr().out
    assert "https://huggingface.co/MuScriptor/muscriptor-small" in out
    assert "tagger: done" in out
    assert (tmp_path / "tagger" / "model.safetensors").is_file()


def test_it_logs_in_once_and_tries_again(tmp_path):
    state = {"in": False, "logins": 0}

    def get(repo, remote, path):
        if not state["in"]:
            raise gated()
        writer()(repo, remote, path)

    def sign_in():
        state["in"] = True
        state["logins"] += 1

    assert run(tmp_path, ["small", "medium"], get=get, sign_in=sign_in, can_ask=True) == 0
    assert state["logins"] == 1
    assert (tmp_path / "medium" / "model.safetensors").is_file()


def test_a_licence_still_refused_after_logging_in_is_reported(tmp_path, capsys):
    logins = []
    refuse = {"MuScriptor/muscriptor-small": gated()}
    assert run(tmp_path, ["small"], get=writer(refuse=refuse), sign_in=lambda: logins.append(1), can_ask=True) == 1
    assert len(logins) == 1
    assert "Accept its licence" in capsys.readouterr().out


def test_a_network_failure_says_to_run_it_again(tmp_path, capsys):
    refuse = {"MuScriptor/muscriptor-small": LocalEntryNotFoundError("no connection")}
    assert run(tmp_path, ["small"], get=writer(refuse=refuse)) == 1
    assert "Run this again" in capsys.readouterr().out


def test_assets_failing_doesnt_stop_the_models(tmp_path, capsys):
    def assets():
        raise OSError("disk")

    assert run(tmp_path, ["small"], assets=assets) == 1
    assert (tmp_path / "small" / "model.safetensors").is_file()


def test_assets_only_touches_no_model(tmp_path):
    ran = []
    assert run(tmp_path, [], assets=lambda: ran.append(1), get=lambda *a: pytest.fail("no models")) == 0
    assert ran == [1]


def test_fetch_is_whole_or_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(im, "ROOT", tmp_path)

    def fails(repo, remote, local_dir):
        raise OSError("cut off")

    monkeypatch.setattr(im, "hf_hub_download", fails)
    target = tmp_path / "small" / "model.safetensors"
    with pytest.raises(OSError):
        im.fetch("a/b", "model.safetensors", target)
    assert not target.exists()


def test_a_copied_model_counts_when_the_server_cant_confirm_it(tmp_path, monkeypatch):
    def refuse(url):
        raise LocalEntryNotFoundError("offline")

    monkeypatch.setattr(im, "get_hf_file_metadata", refuse)
    path = tmp_path / "m.safetensors"
    assert im.already_there("a/b", "m", path) is False
    path.write_bytes(b"x")
    assert im.already_there("a/b", "m", path) is True


def test_only_known_models_are_accepted():
    with pytest.raises(SystemExit):
        im.main(["huge"])
