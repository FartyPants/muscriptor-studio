"""Downloads the models into the folders Studio looks in.

    python -m studio.install_models medium tagger
    python -m studio.install_models --assets-only

The transcription models are gated on Hugging Face: each person accepts their
licence (CC BY-NC 4.0) on the model's page once, then logs in here.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from huggingface_hub import get_hf_file_metadata, hf_hub_download, hf_hub_url, login
from huggingface_hub.errors import GatedRepoError

ROOT = Path(__file__).resolve().parent.parent / "models"


@dataclass(frozen=True)
class Model:
    repo: str
    # File in the repo -> where Studio looks for it, under models/.
    files: tuple[tuple[str, str], ...]
    gated: bool = True

    @property
    def page(self) -> str:
        return f"https://huggingface.co/{self.repo}"


MODELS: dict[str, Model] = {
    "small": Model(
        "MuScriptor/muscriptor-small",
        (("config.json", "small/config.json"), ("model.safetensors", "small/model.safetensors")),
    ),
    "medium": Model(
        "MuScriptor/muscriptor-medium",
        (("config.json", "medium/config.json"), ("model.safetensors", "medium/model.safetensors")),
    ),
    "large": Model(
        "MuScriptor/muscriptor-large",
        (("config.json", "config.json"), ("model.safetensors", "muscriptor-large.safetensors")),
    ),
    # Listens for which instruments play. Public, BSD-3-Clause.
    "tagger": Model(
        "MIT/ast-finetuned-audioset-10-10-0.4593",
        (
            ("config.json", "tagger/config.json"),
            ("model.safetensors", "tagger/model.safetensors"),
            ("preprocessor_config.json", "tagger/preprocessor_config.json"),
        ),
        gated=False,
    ),
}


def already_there(repo: str, remote: str, path: Path) -> bool:
    """Whether `path` holds this file: the right size, when the size can be asked for."""
    if not path.is_file():
        return False
    try:
        return get_hf_file_metadata(hf_hub_url(repo, remote)).size == path.stat().st_size
    except Exception:  # noqa: BLE001 - offline raises the HTTP library's own errors
        # Copied from another computer, say, and the server can't confirm it.
        return path.stat().st_size > 0


def fetch(repo: str, remote: str, path: Path) -> None:
    """Download one file to `path`, whole or not at all."""
    parts = ROOT / ".download"
    got = Path(hf_hub_download(repo, remote, local_dir=parts / repo.replace("/", "--")))
    path.parent.mkdir(parents=True, exist_ok=True)
    os.replace(got, path)


def fetch_assets() -> None:
    """The soundfonts and the beat tracker, into the project's caches."""
    from beat_this.inference import load_checkpoint

    from muscriptor.soundfonts import SF2_URL, SF3_URL
    from muscriptor.utils.download import download_if_necessary

    download_if_necessary(SF3_URL)
    download_if_necessary(SF2_URL)
    load_checkpoint("final0")


def install(
    names: Iterable[str],
    root: Path = ROOT,
    get: Callable[[str, str, Path], None] = fetch,
    present: Callable[[str, str, Path], bool] = already_there,
    sign_in: Callable[[], None] = login,
    assets: Callable[[], None] | None = fetch_assets,
    can_ask: bool | None = None,
) -> int:
    """Download what's missing. Returns how many items couldn't be finished."""
    can_ask = sys.stdin.isatty() if can_ask is None else can_ask
    failed = 0
    signed_in = False

    if assets is not None:
        try:
            print("Downloading the soundfonts and the beat tracker...", flush=True)
            assets()
        except Exception as e:  # noqa: BLE001 - say what happened, and go on to the models
            print(f"The soundfonts or beat tracker could not be downloaded: {e}\nRun this again to finish.")
            failed += 1

    for name in names:
        model = MODELS[name]
        wanted = [(remote, root / local) for remote, local in model.files]
        missing = [(remote, path) for remote, path in wanted if not present(model.repo, remote, path)]
        if not missing:
            print(f"{name}: already there.")
            continue
        print(f"{name}: downloading from {model.repo}...", flush=True)
        for attempt in (1, 2):
            try:
                for remote, path in missing:
                    if not path.is_file() or not present(model.repo, remote, path):
                        get(model.repo, remote, path)
                print(f"{name}: done.")
                break
            except GatedRepoError:
                if attempt == 1 and can_ask and not signed_in:
                    print(f"{name} needs a Hugging Face login, after accepting its licence at {model.page}")
                    signed_in = True
                    try:
                        sign_in()
                        continue
                    except Exception as e:  # noqa: BLE001 - a mistyped token, say
                        print(f"The login didn't work: {e}")
                print(f"{name}: not allowed yet. Accept its licence at {model.page}, log in, then run this again.")
                failed += 1
                break
            except Exception as e:  # noqa: BLE001 - the HTTP library's errors aren't OSErrors
                print(f"{name}: the download stopped ({e}). Run this again to carry on.")
                failed += 1
                break

    if not failed:
        shutil.rmtree(root / ".download", ignore_errors=True)
    return failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m studio.install_models")
    parser.add_argument(
        "models", nargs="*", type=str.lower, choices=[[], *MODELS], metavar="model", help=f"any of: {', '.join(MODELS)}"
    )
    parser.add_argument("--assets-only", action="store_true", help="only the soundfonts and the beat tracker")
    args = parser.parse_args(argv)
    names = [] if args.assets_only else args.models
    failed = install(names)
    if failed:
        print(f"\n{failed} item(s) are unfinished. Run this again when that is sorted out.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
