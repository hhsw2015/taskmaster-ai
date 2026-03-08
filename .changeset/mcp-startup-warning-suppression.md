---
"@hhsw2015/task-master-ai": patch
---

Fix MCP startup failures caused by configuration warnings being printed before the protocol handshake.

This makes Task Master suppress missing-config warnings when running in MCP mode, so `task-master-local` can initialize cleanly even when the derived project root does not contain a local Taskmaster config.
