#!/usr/bin/env bash
# Put the implementation label on each issue given, printing its URL.
# The label comes off first because the worker fires on the labeled event,
# and re-adding a label already on emits none.
set -euo pipefail
[ $# -gt 0 ] || { echo "usage: label.sh <issue number or URL>..." >&2; exit 1; }
for issue in "$@"; do
  "${GH_CMD:-gh}" issue edit "$issue" --remove-label implementation >/dev/null 2>&1 || true
  "${GH_CMD:-gh}" issue edit "$issue" --add-label implementation
done
