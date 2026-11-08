#!/usr/bin/env bash
# Starts MuScriptor Studio on a Mac and opens it in the default browser.
# Not tested yet: see the README.
#   bash start-studio.sh          load no model yet: choose one in Studio
#   bash start-studio.sh medium   load that model now: small, medium or large
# Close this window or press Control + C to stop the server.

cd "$(dirname "$0")" || exit 1

PY=".venv/bin/python"
URL="http://127.0.0.1:8222/"

if [ ! -x "$PY" ]; then
    echo "Studio isn't installed yet. Run: bash install.sh"
    exit 1
fi

MODEL=()
case "$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    small | medium | large) MODEL=(--model "$(echo "$1" | tr '[:upper:]' '[:lower:]')") ;;
esac

. ./env.sh

if curl -sf -o /dev/null --max-time 2 "${URL}studio/api/models"; then
    echo "MuScriptor Studio is already running at ${URL}studio/"
    open "${URL}studio/"
    exit 0
fi

# /health answers but Studio does not: a plain MuScriptor server.
if curl -s -o /dev/null --max-time 2 "${URL}health"; then
    echo "Another MuScriptor server is using port 8222."
    echo "Close its window, then run this again."
    exit 1
fi

echo "Starting MuScriptor Studio"
echo "The browser opens when the server is ready."

# Opens the browser once the server answers (up to about 5 minutes).
(
    for _ in $(seq 1 150); do
        if curl -sf -o /dev/null --max-time 2 "${URL}studio/api/models"; then
            open "${URL}studio/"
            exit 0
        fi
        sleep 2
    done
) &
WAITER=$!
trap 'kill "$WAITER" 2> /dev/null' EXIT

# ${MODEL[@]+...}: an empty array is an error to some shells.
"$PY" -m studio ${MODEL[@]+"${MODEL[@]}"}

echo
echo "Server stopped."
