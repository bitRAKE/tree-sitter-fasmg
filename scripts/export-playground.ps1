param(
    [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

if (-not $OutputDir) {
    $OutputDir = Join-Path $repoRoot 'playground-export'
}

& (Join-Path $scriptDir 'build-wasm.ps1')
& (Join-Path $scriptDir 'ts.ps1') playground --quiet --export $OutputDir
