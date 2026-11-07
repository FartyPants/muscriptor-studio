"""Run MuScriptor Studio: `python -m studio`."""

from __future__ import annotations

import argparse
import logging

import uvicorn

from studio.app import create_studio_app
from studio.models import WEIGHTS, SwitchableModel


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m studio")
    parser.add_argument("--model", choices=list(WEIGHTS), default="large")
    parser.add_argument("--no-model", action="store_true", help="serve without weights (UI work)")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8222)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    holder = SwitchableModel(None if args.device == "auto" else args.device)
    if not args.no_model:
        print(f"Loading {args.model} model...", flush=True)
        holder.load(args.model)
    uvicorn.run(create_studio_app(holder), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
