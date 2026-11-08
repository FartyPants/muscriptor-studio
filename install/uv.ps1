# Puts uv, which installs Python and the packages, inside this project's .tools folder.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$version = "0.11.8"
$sha256 = "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8"
$url = "https://github.com/astral-sh/uv/releases/download/$version/uv-x86_64-pc-windows-msvc.zip"

$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root ".tools"
$target = Join-Path $tools "uv"
$exe = Join-Path $target "uv.exe"

if (Test-Path -LiteralPath $exe) {
    Write-Host "uv is already in this folder."
    exit 0
}

New-Item -ItemType Directory -Force -Path $tools | Out-Null
$zip = Join-Path $tools "uv-$version.zip"
Write-Host "Downloading uv $version..."
Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip

$actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $sha256) {
    Remove-Item -LiteralPath $zip -Force
    throw "The uv download doesn't match its checksum, so it was deleted. Run install.bat again."
}

Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
Remove-Item -LiteralPath $zip -Force
if (-not (Test-Path -LiteralPath $exe)) {
    throw "uv.exe wasn't in the download."
}
Write-Host "uv is ready."
