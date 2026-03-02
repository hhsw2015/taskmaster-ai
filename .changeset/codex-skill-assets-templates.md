---
'@hhsw2015/task-master-ai': patch
---

Improve Codex longrun skill initialization by downloading and wiring upstream Taskmaster skill assets.

- Sync upstream skill asset files into `.codex/skills/taskmaster-longrun/assets/`:
  - `SPEC_TEMPLATE.md`
  - `PROGRESS_TEMPLATE.md`
  - `todo_template.csv`
- Make `codex init` prefer these asset templates when creating runtime `SPEC.md` and `PROGRESS.md`.
