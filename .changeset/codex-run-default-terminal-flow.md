---
"@hhsw2015/task-master-ai": patch
---

Make `task-master codex run` show full task execution flow in terminal by default.

- Keep real-time executor output (`stdout`/`stderr`) enabled by default.
- Add `--no-show-executor-output` to explicitly disable live streaming when needed.
- Improve run visibility with extra `[info]`/`[warn]` lifecycle messages during longrun execution.
