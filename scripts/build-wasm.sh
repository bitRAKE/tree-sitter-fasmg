#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

bash "$script_dir/ts.sh" build --wasm --output "$repo_root/tree-sitter-fasmg.wasm"
