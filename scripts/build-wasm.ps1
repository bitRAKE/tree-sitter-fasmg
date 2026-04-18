$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$output = Join-Path $repoRoot 'tree-sitter-fasmg.wasm'

& (Join-Path $scriptDir 'ts.ps1') build --wasm --output $output
