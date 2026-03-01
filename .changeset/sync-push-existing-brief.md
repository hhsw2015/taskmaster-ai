---
"@hhsw2015/task-master-ai": patch
---

Added a native `sync push` command to push local tasks into an existing Hamster brief (without creating a new brief).

- New command: `task-master sync push`
- Supports explicit brief targeting via `--brief <brief-id-or-url>`
- Supports local tag selection via `--tag <tag>`
- Supports non-interactive automation via `--yes` / `--non-interactive`
- Fails fast in non-interactive mode when no brief context is available
