---
'@hhsw2015/task-master-ai': patch
---

Improve Codex longrun stability with runner-controlled execution outcomes and timeout controls.

- Add machine-readable `TM_RESULT` parsing so runner can reliably decide task success/failure and write Taskmaster status.
- Add per-task timeout controls:
  - `--exec-idle-timeout-ms` (default enabled)
  - `--exec-hard-timeout-ms` (optional hard cap)
  - `--exec-hard-timeout-ms 0` to disable hard timeout
- Keep backward compatibility for `--exec-timeout-ms` as an alias of hard timeout.
