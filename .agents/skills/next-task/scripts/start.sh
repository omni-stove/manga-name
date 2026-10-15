#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
id=${1:?usage: start.sh <id> [--decided]}
field() {
  jq -r --arg id "$1" --arg k "$2" '.tasks[] | select(.id == $id) | .[$k] | if type == "array" then .[] else . end' docs/tasks.json
}
case $(field "$id" status) in
  "") echo "start: task $id is not in docs/tasks.json — run next.sh and pick a listed id" >&2; exit 1 ;;
  done) echo "start: task $id is already done — run next.sh and pick another" >&2; exit 1 ;;
  todo) scripts/tasks.sh start "$id" ${2:-} ;;
esac
scripts/tasks.sh show "$id"
echo
echo "Principles:"
jq -r '.principles[] | "  - \(.)"' docs/tasks.json
field "$id" spec | while read -r spec; do
  file=docs/${spec%% *}
  echo
  echo "===== $spec"
  cat "$file"
done
echo
echo "Next: implement inside 範囲 only, and nothing beyond the implementation: no tests, no lint, no pnpm check, no git branch or commit. Import other packages only through @manga/schema. When the task needs a change to docs/03-data-model.md or docs/04-diagnosis-spec.md, report the change and stop"
echo "When the implementation is written, run .agents/skills/next-task/scripts/finish.sh $id"
