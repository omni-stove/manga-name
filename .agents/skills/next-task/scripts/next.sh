#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
scripts/tasks.sh next
echo
echo "Next: pick one and run .agents/skills/next-task/scripts/start.sh <id>. For a task under 決定待ち, add --decided only when docs/06-open-questions.md records the decision"
