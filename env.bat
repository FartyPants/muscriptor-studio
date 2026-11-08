@echo off
rem Keeps everything this project downloads inside its own folder.
rem Called by install.bat and the start scripts. Changes nothing on disk.

set "MUSCRIPTOR_ROOT=%~dp0"
set "MUSCRIPTOR_ROOT=%MUSCRIPTOR_ROOT:~0,-1%"

set "UV_PYTHON_INSTALL_DIR=%MUSCRIPTOR_ROOT%\.tools\python"
set "UV_CACHE_DIR=%MUSCRIPTOR_ROOT%\.tools\uv-cache"
set "UV_TOOL_DIR=%MUSCRIPTOR_ROOT%\.tools\uv-tools"
set "HF_HOME=%MUSCRIPTOR_ROOT%\models\hf"
rem Apart from models, so copying models to another computer leaves the login behind.
set "HF_TOKEN_PATH=%MUSCRIPTOR_ROOT%\.tools\hf-token"
set "TORCH_HOME=%MUSCRIPTOR_ROOT%\models\torch"
set "PYTHONIOENCODING=utf-8"

rem The project's own MuseScore if it has one, then a normal install. If neither
rem exists the variable stays unset, and MuScriptor searches the usual places.
if exist "%MUSCRIPTOR_ROOT%\.tools\MuseScore\bin\MuseScore4.exe" (
    set "MUSCRIPTOR_MUSESCORE=%MUSCRIPTOR_ROOT%\.tools\MuseScore\bin\MuseScore4.exe"
) else if not defined MUSCRIPTOR_MUSESCORE if exist "C:\Program Files\MuseScore 4\bin\MuseScore4.exe" (
    set "MUSCRIPTOR_MUSESCORE=C:\Program Files\MuseScore 4\bin\MuseScore4.exe"
)
