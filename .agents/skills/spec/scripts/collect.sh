#!/usr/bin/env bash
# usage: collect.sh [path]...   (no path: the map of the whole repo)
set -euo pipefail
dir="$(dirname -- "$0")"

node "$dir/extract.ts" "$@"
if [ "$#" -eq 0 ]; then cat "$dir/../prompts/map.txt" >&2; else cat "$dir/../prompts/detail.txt" >&2; fi
