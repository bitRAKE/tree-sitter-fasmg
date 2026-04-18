#!/usr/bin/env bash
# Forwards to the tree-sitter CLI resolved via $TREE_SITTER_PATH.
#
# - $TREE_SITTER_PATH should point at the *directory* containing the binary,
#   not the binary itself. Defaults to C:/third_party/tree-sitter (Windows).
# - The CLI is intentionally not vendored: pin the version yourself and
#   keep the committed src/parser.c in sync (see package.json devDeps for
#   the version the current parser.c was generated with).

set -euo pipefail

ts_dir="${TREE_SITTER_PATH:-C:/third_party/tree-sitter}"

if [[ -x "$ts_dir/tree-sitter.exe" ]]; then
    exe="$ts_dir/tree-sitter.exe"
elif [[ -x "$ts_dir/tree-sitter" ]]; then
    exe="$ts_dir/tree-sitter"
else
    echo "error: tree-sitter CLI not found in $ts_dir" >&2
    echo "       set TREE_SITTER_PATH to the directory containing tree-sitter[.exe]" >&2
    exit 127
fi

exec "$exe" "$@"
