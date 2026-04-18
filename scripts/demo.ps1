param(
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

& (Join-Path $scriptDir 'build-wasm.ps1')

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $python = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $python) {
    throw 'python or py is required to serve the playground'
}

Write-Host "Serving fasmg playground at http://127.0.0.1:$Port/web/playground/"
& $python.Source -m http.server $Port --bind 127.0.0.1 --directory $repoRoot
