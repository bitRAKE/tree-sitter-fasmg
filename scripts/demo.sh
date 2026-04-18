#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
port="${1:-8000}"

bash "$script_dir/build-wasm.sh"

if command -v python3 >/dev/null 2>&1; then
    python_cmd="python3"
elif command -v python >/dev/null 2>&1; then
    python_cmd="python"
else
    echo "error: python3 or python is required to serve the playground" >&2
    exit 127
fi

echo "Serving fasmg playground at http://127.0.0.1:${port}/web/playground/"
exec "$python_cmd" -m http.server "$port" --bind 127.0.0.1 --directory "$repo_root"
