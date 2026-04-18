#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
output_dir="${1:-$repo_root/playground-export}"

bash "$script_dir/build-wasm.sh"
bash "$script_dir/ts.sh" playground --quiet --export "$output_dir"
