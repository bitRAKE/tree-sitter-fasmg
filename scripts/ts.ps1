# Forwards to the tree-sitter CLI resolved via $env:TREE_SITTER_PATH.
#
# - $env:TREE_SITTER_PATH should point at the *directory* containing the
#   binary, not the binary itself. Defaults to C:\third_party\tree-sitter.
# - The CLI is intentionally not vendored: pin the version yourself and
#   keep the committed src\parser.c in sync (see package.json devDeps for
#   the version the current parser.c was generated with).

$ErrorActionPreference = 'Stop'

$tsDir = if ($env:TREE_SITTER_PATH) { $env:TREE_SITTER_PATH } else { 'C:\third_party\tree-sitter' }
$exe = Join-Path $tsDir 'tree-sitter.exe'

if (-not (Test-Path $exe)) {
    Write-Error "tree-sitter CLI not found at $exe (set `$env:TREE_SITTER_PATH to the directory containing tree-sitter.exe)"
    exit 127
}

& $exe @args
exit $LASTEXITCODE
