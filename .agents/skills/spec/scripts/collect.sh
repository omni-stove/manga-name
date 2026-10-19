#!/usr/bin/env bash
# usage: collect.sh [path]...   (no path: apps/web/src, the app's screens)
set -euo pipefail
dir="$(dirname -- "$0")"

if [ "$#" -eq 0 ]; then
  node "$dir/extract.ts" apps/web/src
  cat "$dir/../prompts/overview.txt" >&2
else
  node "$dir/extract.ts" "$@"
  cat "$dir/../prompts/detail.txt" >&2
fi
