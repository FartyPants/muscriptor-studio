#!/usr/bin/env bash
# Installs MuScriptor Studio into this folder, on a Mac with Apple Silicon.
# Not tested yet: see the README.
#   bash install.sh                  asks which models to download
#   bash install.sh small tagger     downloads those
#   bash install.sh none             skips the models
# Safe to run again: each step skips what's already done.

cd "$(dirname "$0")" || exit 1

if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is for a Mac. On Windows, use install.bat."
    exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
    echo "This script needs a Mac with Apple Silicon (M1 or later)."
    echo "PyTorch no longer supports Intel Macs at the version Studio uses."
    exit 1
fi

. ./env.sh

UV_VERSION="0.11.8"
UV_SHA256="c729adb365114e844dd7f9316313a7ed6443b89bb5681d409eebac78b0bd06c8"
UV_URL="https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-aarch64-apple-darwin.tar.gz"
MUSESCORE_VERSION="4.7.6.261022093"
MUSESCORE_SHA256="dd78357e652a4df6ec074b9bd63a79e09eedb7c1c9dd6262eb7d9304508dec9c"
MUSESCORE_URL="https://github.com/musescore/MuseScore/releases/download/v4.7.6/MuseScore-Studio-$MUSESCORE_VERSION.dmg"

UV=".tools/uv/uv"
PY=".venv/bin/python"
STEP=""

failed() {
    echo
    echo "Install stopped while $STEP. The message above says why."
    echo "Fix that and run install.sh again: finished steps are skipped."
    exit 1
}

# Whether file $1 has the sha256 $2.
matches() {
    [ "$(shasum -a 256 "$1" | cut -d ' ' -f 1)" = "$2" ]
}

# Asked first, so the long downloads can then run with nobody watching.
MODELS="$*"
if [ -z "$MODELS" ]; then
    echo
    echo "Which models do you want?"
    echo "  small    fastest"
    echo "  medium   recommended"
    echo "  large    most accurate, needs a lot of memory"
    echo "  tagger   for the Detect instruments button"
    echo "Press Enter for the recommended ones, or type names with spaces between them."
    echo "Type none to skip this, if you will copy the models from another computer."
    echo
    read -r -p "Models to download [medium tagger]: " MODELS
    [ -z "$MODELS" ] && MODELS="medium tagger"
fi

if [ ! -f "$HF_TOKEN_PATH" ] && echo "$MODELS" | grep -qiE 'small|medium|large'; then
    echo
    echo "These models need the Hugging Face token from Step 1 of the README."
    echo "To paste it here, press Command + V."
    echo
    read -r -p "Paste your token and press Enter (leave empty to skip): " TOKEN
    if [ -n "$TOKEN" ]; then
        mkdir -p .tools
        (umask 077; printf '%s\n' "$TOKEN" > "$HF_TOKEN_PATH")
    fi
fi

echo
echo "[1/6] uv, the tool that installs Python and the packages"
STEP="downloading uv"
if [ -x "$UV" ]; then
    echo "uv is already in this folder."
else
    mkdir -p .tools/uv
    curl -fL --retry 3 -o ".tools/uv-$UV_VERSION.tar.gz" "$UV_URL" || failed
    if ! matches ".tools/uv-$UV_VERSION.tar.gz" "$UV_SHA256"; then
        rm -f ".tools/uv-$UV_VERSION.tar.gz"
        echo "The uv download doesn't match its checksum, so it was deleted."
        failed
    fi
    tar -xzf ".tools/uv-$UV_VERSION.tar.gz" -C .tools/uv --strip-components=1 || failed
    rm -f ".tools/uv-$UV_VERSION.tar.gz"
    [ -x "$UV" ] || failed
fi

echo
echo "[2/6] Python 3.13"
STEP="installing Python"
"$UV" python install 3.13 --no-bin || failed

echo
echo "[3/6] Python environment"
STEP="creating .venv"
if [ -x "$PY" ]; then
    echo ".venv is already here."
else
    "$UV" venv .venv --python 3.13 --managed-python || failed
fi

echo
echo "[4/6] Packages"
STEP="installing the packages"
# Relative paths: uv split an absolute one at a space.
"$UV" pip install --python "$PY" -c install/constraints.txt -e . -r studio/requirements.txt || failed

echo
echo "[5/6] MuseScore, for the Score tab and PDFs"
install_musescore() {
    local dmg=".tools/MuseScore-$MUSESCORE_VERSION.dmg"
    local mount=".tools/MuseScore-mount"
    mkdir -p .tools
    echo "Downloading MuseScore $MUSESCORE_VERSION (207 MB)..."
    curl -fL --retry 3 -o "$dmg" "$MUSESCORE_URL" || return 1
    if ! matches "$dmg" "$MUSESCORE_SHA256"; then
        rm -f "$dmg"
        echo "The MuseScore download doesn't match its checksum, so it was deleted."
        return 1
    fi
    echo "Copying MuseScore into .tools..."
    mkdir -p "$mount" .tools/MuseScore
    # yes: answers a licence prompt, if the disk image shows one.
    yes | hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$PWD/$mount" > /dev/null || return 1
    local app
    app="$(find "$mount" -maxdepth 1 -name 'MuseScore*.app' | head -n 1)"
    local result=1
    if [ -n "$app" ] && ditto "$app" ".tools/MuseScore/$(basename "$app")"; then
        result=0
    fi
    hdiutil detach "$PWD/$mount" -quiet
    rmdir "$mount" 2> /dev/null
    rm -f "$dmg"
    return "$result"
}
if [ -n "${MUSCRIPTOR_MUSESCORE:-}" ]; then
    echo "Using the MuseScore at $MUSCRIPTOR_MUSESCORE"
elif install_musescore && . ./env.sh && [ -n "${MUSCRIPTOR_MUSESCORE:-}" ]; then
    echo "MuseScore is ready."
else
    echo "MuseScore could not be installed here. Everything else carries on."
    echo "For the Score tab and PDFs, install MuseScore 4 from https://musescore.org into Applications."
fi

echo
echo "[6/6] Models"
if [ "$(echo "$MODELS" | tr '[:upper:]' '[:lower:]')" = "none" ]; then
    "$PY" -m studio.install_models --assets-only
else
    # Unquoted: each name is its own argument.
    "$PY" -m studio.install_models $MODELS
fi
if [ $? -ne 0 ]; then
    echo
    echo "Everything else is installed. Some downloads are unfinished, as listed above."
    echo "Run install.sh again to finish them."
    exit 1
fi

echo
echo "Done. Start MuScriptor Studio with: bash start-studio.sh"
