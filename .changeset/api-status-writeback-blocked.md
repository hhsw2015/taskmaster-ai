---
"@hhsw2015/task-master-ai": patch
---

Fix cloud status writeback failures when Taskmaster uses non-native statuses like `blocked`, `review`, `deferred`, or `cancelled`.

- Map extended Taskmaster statuses to API-compatible values instead of throwing.
- Preserve original Taskmaster status in task metadata and restore it on read, so CLI still shows the intended status.
- Prevent `Failed to update task status via API` during longrun/auto execution flows.
