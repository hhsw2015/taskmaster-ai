---
"@hhsw2015/task-master-ai": patch
---

Added first-class non-interactive export mode for automation/LLM use.

- `tm export` now supports `--yes` / `--non-interactive` to skip interactive prompts.
- Added `--invite-emails` for non-interactive collaborator invites.
- Added `--all-unexported` to export all local unexported tags without manual selection.
- When already connected to a brief, non-interactive export no longer blocks on confirmation.
- Auth/org guard now supports non-interactive behavior and fails fast with actionable errors instead of waiting for prompts.
