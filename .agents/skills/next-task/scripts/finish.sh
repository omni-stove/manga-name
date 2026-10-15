#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
id=${1:?usage: finish.sh <id> [--visual]}
title=$(node -e '
const t = JSON.parse(require("fs").readFileSync("docs/tasks.json", "utf8")).tasks.find((t) => t.id === process.argv[1])
if (!t) { console.error(`finish: task ${process.argv[1]} is not in docs/tasks.json`); process.exit(1) }
console.log(t.title)' "$id")
if [ "${2:-}" = "--visual" ]; then
  git add -A
  git commit -q -m "task $id: $title"
  echo "committed on $(git branch --show-current); task $id stays in progress"
  echo "完了条件 left for the user to check by eye:"
  node -e '
const t = JSON.parse(require("fs").readFileSync("docs/tasks.json", "utf8")).tasks.find((t) => t.id === process.argv[1])
for (const v of t.verify.filter((v) => v.includes("目視"))) console.log(`  - ${v}`)' "$id"
  echo "Next: tell the user what to look at for each item above, and that make tasks done $id marks the task done"
else
  mise run -q tasks done "$id"
  git add -A
  git commit -q -m "task $id: $title"
  echo "done: task $id committed on $(git branch --show-current)"
  echo "Next: report what was built and which 完了条件 passed"
fi
