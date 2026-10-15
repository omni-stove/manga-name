---
name: next-task
description: Implement one task from docs/tasks.json and mark it done. Use when the user says "次のタスク", "next task", "着手してないやつをやって", or names a task id.
---

Run `.agents/skills/next-task/scripts/next.sh`. Take the task the user named, else choose the first under 着手できる. Take one under 着手中 only when the user names it. For one under 決定待ち, find the decision in `docs/06-open-questions.md`; without one, tell the user and stop.

Run `.agents/skills/next-task/scripts/start.sh <id>` and follow what it prints through to `finish.sh`.

Report what was built and what `finish.sh` printed.
