---
"@hhsw2015/task-master-ai": patch
---

Fix `task-master expand` routing so local CLI providers (including `codex-cli`) do not delegate subtask expansion to Hamster.

When a local CLI provider is active, expansion now stays on the local execution path.
