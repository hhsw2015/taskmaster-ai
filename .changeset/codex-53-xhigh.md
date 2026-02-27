---
"task-master-ai": patch
---

Add explicit Codex CLI support for `gpt-5.3-codex` with `xhigh` reasoning effort in provider validation logic and supported model metadata.

This prevents unnecessary fallback from `xhigh` to `high` when using GPT-5.3 Codex through Task Master's Codex provider path.
