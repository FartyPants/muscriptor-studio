@echo off
rem Starts MuScriptor Studio and opens it in the default browser.
rem   start-studio.bat          load no model yet: choose one in Studio
rem   start-studio.bat large    load the large model now
rem   start-studio.bat medium   load the medium model now
rem   start-studio.bat small    load the small model now
rem Close this window or press Ctrl+C to stop the server.
rem Runs .venv directly: "uv run" would re-sync and replace GPU torch with CPU torch.

setlocal
cd /d "%~dp0"
title MuScriptor Studio

set "URL=http://127.0.0.1:8222/"
set "MODEL="
if /i "%~1"=="large" set "MODEL=--model large"
if /i "%~1"=="medium" set "MODEL=--model medium"
if /i "%~1"=="small" set "MODEL=--model small"

call "%~dp0env.bat"

curl.exe -sf -o nul --max-time 2 "%URL%studio/api/models"
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

echo Starting MuScriptor Studio
echo The browser opens when the server is ready.

rem Background wait: open the browser once the server answers (up to about 5 minutes).
start "" /b powershell -NoProfile -Command "foreach ($i in 1..150) { try { $null = Invoke-WebRequest '%URL%studio/api/models' -UseBasicParsing -TimeoutSec 2; Start-Process '%URL%studio/'; break } catch { Start-Sleep 2 } }"

rem After the browser wait above started: only Python gets the project's home folder.
call "%~dp0env.bat" home
".venv\Scripts\python.exe" -m studio %MODEL%

echo.
echo Server stopped.
pause
