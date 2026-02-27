---
"@tm/core": patch
"@tm/cli": patch
---

Add configurable executor selection for loop and start workflows so users can run Task Master with either Claude CLI or Codex CLI.

This also improves fallback behavior and messaging around sandbox/auth support, and aligns loop/start command help text with backend-agnostic execution.
