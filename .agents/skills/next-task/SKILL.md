---
name: next-task
description: Implement one task from docs/tasks.json and mark it done. Use when the user says "次のタスク", "next task", "着手してないやつをやって", or names a task id.
---

Run `.agents/skills/next-task/scripts/next.sh`. Take the task the user named, else choose the first under 着手できる. Take one under 着手中 only when the user names it. For one under 決定待ち, find the decision in `docs/06-open-questions.md`; without one, tell the user and stop.

Run `.agents/skills/next-task/scripts/start.sh <id>`, write the implementation it describes, then run `.agents/skills/next-task/scripts/finish.sh <id>` right away. It marks the task done; do not check the 完了条件 or ask before running it.

Do nothing beyond the implementation: no tests, no lint, no `pnpm check`, no git branch, no commit.

Report what was built.
