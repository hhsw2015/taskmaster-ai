---
"task-master-ai": patch
---

Codex CLI execution now prefers the system `codex` binary by default when available in `PATH`.

If no global `codex` executable is found, Task Master falls back to the provider's existing bundled resolution behavior.

Explicit `codexPath` configuration is still respected and will override the default selection.
