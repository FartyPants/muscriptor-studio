# Puts MuseScore inside this project's .tools folder.
#
# The official installer is unpacked rather than run, so it needs no
# administrator and leaves nothing in Program Files or the Windows app list.
# A MuseScore 4 already installed in the usual place is used instead, unless
# -Force is given.

param([switch]$Force)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$version = "4.7.6.261022093"
$url = "https://github.com/musescore/MuseScore/releases/download/v4.7.6/MuseScore-Studio-$version-x86_64.msi"
$sha256 = "41c9ca34fbf0b720f229ed3b0c4ff923b5d41a8c24ad9262e1fce390cd5c34e5"

$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root ".tools"
$target = Join-Path $tools "MuseScore"
$exe = Join-Path $target "MuseScore 4\bin\MuseScore4.exe"
$system = "C:\Program Files\MuseScore 4\bin\MuseScore4.exe"

if (Test-Path -LiteralPath $exe) {
    Write-Host "MuseScore is already in this folder."
    exit 0
}
if (-not $Force -and (Test-Path -LiteralPath $system)) {
    Write-Host "Using the MuseScore already installed in Program Files."
    exit 0
}

$msi = Join-Path $tools "MuseScore-$version.msi"
New-Item -ItemType Directory -Force -Path $tools | Out-Null
Write-Host "Downloading MuseScore $version (135 MB)..."
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $msi

$actual = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $sha256) {
    Remove-Item -LiteralPath $msi -Force
    throw "The MuseScore download doesn't match its checksum, so it was deleted. Run install.bat again."
}

Write-Host "Unpacking MuseScore into .tools..."
$arguments = "/a `"$msi`" /qn TARGETDIR=`"$target`""
$process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
Remove-Item -LiteralPath $msi -Force
Get-ChildItem -LiteralPath $target -Filter "*.msi" -ErrorAction SilentlyContinue | Remove-Item -Force

if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
    # A very long folder path is the usual cause: 138 characters failed with 1603.
    Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    throw "MuseScore could not be unpacked (msiexec exit code $($process.ExitCode)). Keep this project in a short folder path such as C:\MuScriptor and run install.bat again, or install MuseScore from https://musescore.org/en/download."
}
Write-Host "MuseScore is ready."
