---
"@hhsw2015/task-master-ai": patch
---

Fixed `sync push` for large task sets by batching task import requests to Hamster.

- Automatically splits bulk sync payloads into batches of up to 100 tasks
- Prevents API validation failures for projects with more than 100 tasks/subtasks
- Preserves existing sync behavior while improving reliability for larger plans
