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
rem Versions from uv.lock, but with "uv pip": "uv sync" would replace GPU torch with CPU torch.
"%UV%" export --frozen --no-hashes --no-emit-project --no-dev -q -o "%MUSCRIPTOR_ROOT%\.tools\constraints.txt"
if errorlevel 1 goto failed
"%UV%" pip install --python "%PY%" --torch-backend=%BACKEND% -c "%MUSCRIPTOR_ROOT%\.tools\constraints.txt" -e . -r studio\requirements.txt
if errorlevel 1 goto failed

echo.
echo [5/6] MuseScore, for the Score tab and PDFs
set "STEP=installing MuseScore"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\musescore.ps1"
if errorlevel 1 goto failed

echo.
echo [6/6] Models
set "MODELS=%*"
if not "%MODELS%"=="" goto have_models
echo Choose from: small medium large tagger
echo   small    fastest, for computers without a GPU, about 1.5 GB of GPU memory
echo   medium   recommended, about 3 GB of GPU memory
echo   large    most accurate, needs 12 GB of GPU memory
echo   tagger   listens for which instruments play, for Detect instruments
echo The three transcription models need a free Hugging Face account: accept each
echo model's licence on its page first. Links are in the README.
set /p "MODELS=Models to download [medium tagger]: "
if "%MODELS%"=="" set "MODELS=medium tagger"
:have_models
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
