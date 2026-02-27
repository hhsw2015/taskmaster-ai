---
"task-master-ai": patch
---

Add a Codex execution preflight check that runs before `start` and `loop` when using the Codex executor.

If the project is not trusted in `~/.codex/config.toml` or Codex approval policy is not set to unattended mode (`never`), Task Master now refuses execution and shows exact remediation guidance instead of hanging on interactive approvals.
