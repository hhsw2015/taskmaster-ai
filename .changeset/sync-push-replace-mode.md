---
'@hhsw2015/task-master-ai': patch
---

Add `tm sync push --mode replace` to support overwrite-style sync into an existing Hamster brief.

When `--mode replace` is used, Task Master now clears existing tasks in the target brief before importing local tasks, preventing duplicate historical entries from repeated sync runs.
