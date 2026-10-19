#!/usr/bin/env bash
# usage: collect.sh [path]...   (no path: the map of the whole repo)
set -euo pipefail
. "$(dirname -- "$0")/../../../refs/prompt.sh"

node "$(dirname -- "$0")/extract.ts" "$@"
if [ "$#" -eq 0 ]; then prompt map >&2; else prompt detail >&2; fi
