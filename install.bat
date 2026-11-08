@echo off
rem Installs MuScriptor Studio into this folder, and nothing outside it.
rem   install.bat                  asks which models to download
rem   install.bat small tagger     downloads those
rem   install.bat none             skips the models
rem Safe to run again: each step skips what's already done.

setlocal
cd /d "%~dp0"
title Install MuScriptor Studio
call "%~dp0env.bat"
set "UV=%MUSCRIPTOR_ROOT%\.tools\uv\uv.exe"
set "PY=%MUSCRIPTOR_ROOT%\.venv\Scripts\python.exe"

rem Asked first, so the long downloads can then run with nobody watching.
set "MODELS=%*"
if not "%MODELS%"=="" goto have_models
echo.
echo Which models do you want?
echo   small    fastest, for computers without an NVIDIA graphics card
echo   medium   recommended, needs 3 GB of graphics memory
echo   large    most accurate, needs 12 GB of graphics memory
echo   tagger   for the Detect instruments button
echo Press Enter for the recommended ones, or type names with spaces between them.
echo Type none to skip this, if you will copy the models from another computer.
echo.
set /p "MODELS=Models to download [medium tagger]: "
if "%MODELS%"=="" set "MODELS=medium tagger"

if exist "%HF_TOKEN_PATH%" goto have_models
echo %MODELS%| findstr /i "small medium large" >nul
if errorlevel 1 goto have_models
echo.
echo These models need the Hugging Face token from Step 1 of the README.
echo To paste it here, click the right mouse button.
echo.
set "TOKEN="
set /p "TOKEN=Paste your token and press Enter (leave empty to skip): "
if "%TOKEN%"=="" goto have_models
if not exist "%MUSCRIPTOR_ROOT%\.tools" mkdir "%MUSCRIPTOR_ROOT%\.tools"
>"%HF_TOKEN_PATH%" echo %TOKEN%
:have_models

echo.
echo [1/6] uv, the tool that installs Python and the packages
set "STEP=downloading uv"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\uv.ps1"
if errorlevel 1 goto failed

echo.
echo [2/6] Python 3.13
set "STEP=installing Python"
rem --no-bin and --no-registry: no links in the user's folders, no registry entries.
"%UV%" python install 3.13 --no-bin --no-registry
if errorlevel 1 goto failed

echo.
echo [3/6] Python environment
set "STEP=creating .venv"
if exist "%PY%" (
    echo .venv is already here.
) else (
    "%UV%" venv "%MUSCRIPTOR_ROOT%\.venv" --python 3.13 --managed-python
    if errorlevel 1 goto failed
)

echo.
echo [4/6] Packages
set "STEP=installing the packages"
set "BACKEND=cpu"
nvidia-smi -L >nul 2>&1
if not errorlevel 1 set "BACKEND=cu128"
if "%BACKEND%"=="cu128" (echo NVIDIA GPU found: installing PyTorch for CUDA.) else (echo No NVIDIA GPU found: installing PyTorch for the CPU. Transcription will be slow.)
rem "uv pip", not "uv sync", which would replace GPU torch with CPU torch. Relative
rem paths: uv split an absolute one at a space.
"%UV%" pip install --python ".venv\Scripts\python.exe" --torch-backend=%BACKEND% -c install\constraints.txt -e . -r studio\requirements.txt
if errorlevel 1 goto failed

echo.
echo [5/6] MuseScore, for the Score tab and PDFs
set "STEP=installing MuseScore"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\musescore.ps1"
if errorlevel 1 goto failed

echo.
echo [6/6] Models
rem Python gets the project's home folder, so nothing it runs writes to the real one.
call "%~dp0env.bat" home
if /i "%MODELS%"=="none" (
    "%PY%" -m studio.install_models --assets-only
) else (
    "%PY%" -m studio.install_models %MODELS%
)
if errorlevel 1 (
    echo.
    echo Everything else is installed. Some downloads are unfinished, as listed above.
    echo Run install.bat again to finish them.
    pause
    exit /b 1
)

echo.
echo Done. Start MuScriptor Studio with start-studio.bat
pause
exit /b 0

:failed
echo.
echo Install stopped while %STEP%. The message above says why.
echo Fix that and run install.bat again: finished steps are skipped.
pause
exit /b 1
