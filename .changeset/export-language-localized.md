---
"@hhsw2015/task-master-ai": patch
---

Exported task descriptions now follow your configured response language. Chinese mode outputs Chinese section headings and fallback text, while English mode keeps the existing English wording.

When creating a Hamster brief from local tasks, Task Master now forwards the preferred language for generated brief metadata and automatically retries without that field if the backend enforces a strict schema.
