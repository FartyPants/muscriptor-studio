@echo off
rem Starts MuScriptor Studio and opens it in the default browser.
rem   start-studio.bat          large model (default)
rem   start-studio.bat medium   medium model
rem The model can also be changed inside Studio.
rem Close this window or press Ctrl+C to stop the server.
rem Runs .venv directly: "uv run" would re-sync and replace GPU torch with CPU torch.

setlocal
cd /d "%~dp0"
title MuScriptor Studio

set "URL=http://127.0.0.1:8222/"
set "MODEL=large"
if /i "%~1"=="medium" set "MODEL=medium"

if not defined MUSCRIPTOR_MUSESCORE set "MUSCRIPTOR_MUSESCORE=C:\Program Files\MuseScore 4\bin\MuseScore4.exe"
set "PYTHONIOENCODING=utf-8"

curl.exe -s -o nul --max-time 2 "%URL%studio/api/models"
if not errorlevel 1 (
    echo MuScriptor Studio is already running at %URL%studio/
    start "" "%URL%studio/"
    timeout /t 8
    exit /b 0
)

rem /health answers but Studio does not: the plain server from start-web.bat.
curl.exe -s -o nul --max-time 2 "%URL%health"
if not errorlevel 1 (
    echo Another MuScriptor server is using port 8222.
    echo Close its window, then run this again.
    pause
    exit /b 1
)

echo Starting MuScriptor Studio with the %MODEL% model
echo The browser opens when the model has loaded.

rem Background wait: open the browser once the server answers (up to about 5 minutes).
start "" /b powershell -NoProfile -Command "foreach ($i in 1..150) { try { $null = Invoke-WebRequest '%URL%studio/api/models' -UseBasicParsing -TimeoutSec 2; Start-Process '%URL%studio/'; break } catch { Start-Sleep 2 } }"

".venv\Scripts\python.exe" -m studio --model %MODEL%

echo.
echo Server stopped.
pause
