---
"@hhsw2015/task-master-ai": patch
---

Make Codex CLI the default local executor for generated Task Master configs.

Default configs now use non-interactive Codex execution (`approvalMode: never`, `fullAuto: true`, `sandboxMode: danger-full-access`, `skipGitRepoCheck: true`) with `reasoningEffort: xhigh`, and default response language is set to `Chinese`.

Also fixes `task-master lang --response ...` failing with `successMessage is not defined`.
