"""Run MuScriptor Studio: `python -m studio`."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

import uvicorn

from studio.app import create_studio_app
from studio.models import ORIGINAL_UI_MODEL, WEIGHTS, SwitchableModel
from studio.projects import DATA_DIR


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m studio")
    parser.add_argument(
        "--model",
        choices=list(WEIGHTS),
        help="load this model now, instead of when one is chosen in Studio",
    )
    parser.add_argument(
        "--no-model",
        action="store_true",
        help="never load weights, not even for the original interface (UI work)",
    )
    parser.add_argument("--device", default="auto")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8222)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    holder = SwitchableModel(None if args.device == "auto" else args.device)
    if args.model:
        print(f"Loading {args.model} model...", flush=True)
        holder.load(args.model)
    app = create_studio_app(
        holder,
        data_dir=args.data_dir,
        autoload=None if args.no_model else ORIGINAL_UI_MODEL,
    )
    print(f"Studio: http://{args.host}:{args.port}/studio/", flush=True)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
