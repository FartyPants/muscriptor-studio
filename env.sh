# Keeps what this project downloads inside its own folder, on a Mac.
# Source it from the project's folder: install.sh and start-studio.sh do.
# Changes nothing on disk. Not tested yet: see the README.

MUSCRIPTOR_ROOT="$PWD"
export MUSCRIPTOR_ROOT

export UV_PYTHON_INSTALL_DIR="$MUSCRIPTOR_ROOT/.tools/python"
export UV_CACHE_DIR="$MUSCRIPTOR_ROOT/.tools/uv-cache"
export UV_TOOL_DIR="$MUSCRIPTOR_ROOT/.tools/uv-tools"
export HF_HOME="$MUSCRIPTOR_ROOT/models/hf"
# Apart from models, so copying models to another computer leaves the login behind.
export HF_TOKEN_PATH="$MUSCRIPTOR_ROOT/.tools/hf-token"
export TORCH_HOME="$MUSCRIPTOR_ROOT/models/torch"
export PYTHONIOENCODING=utf-8

# The project's own MuseScore if it has one, then one in Applications.
# find, because a glob with no match is an error when zsh sources this.
muscriptor_find_musescore() {
    app="$(find "$1" -maxdepth 1 -name 'MuseScore*.app' 2>/dev/null | head -n 1)"
    if [ -n "$app" ] && [ -x "$app/Contents/MacOS/mscore" ]; then
        printf '%s\n' "$app/Contents/MacOS/mscore"
    fi
}

muscriptor_musescore="$(muscriptor_find_musescore "$MUSCRIPTOR_ROOT/.tools/MuseScore")"
if [ -z "$muscriptor_musescore" ] && [ -z "${MUSCRIPTOR_MUSESCORE:-}" ]; then
    muscriptor_musescore="$(muscriptor_find_musescore /Applications)"
fi
if [ -n "$muscriptor_musescore" ]; then
    export MUSCRIPTOR_MUSESCORE="$muscriptor_musescore"
fi
unset muscriptor_musescore
