#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
id=${1:?usage: finish.sh <id>}
scripts/tasks.sh done "$id"
echo "Next: report what was built. Do not run tests, lint, pnpm check, or git"
