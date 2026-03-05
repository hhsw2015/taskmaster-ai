---
"@hhsw2015/task-master-ai": patch
---

Automatically inject project-level Taskmaster quick triggers into `AGENTS.md` during `task-master codex init`.

- Adds built-in shortcuts for Chinese commands:
  - `拆分任务`: write PRD and run `task-master parse-prd`
  - `开始实现`: run `task-master codex run` in foreground (uses active tag, not hardcoded `master`)
- Keeps longrun behavior unchanged while removing the need to repeat long prompt instructions each time.
