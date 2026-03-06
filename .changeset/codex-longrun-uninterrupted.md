---
"@tm/core": patch
"@tm/cli": patch
---

Improve Codex longrun startup so projects get a dedicated launcher, clearer init guidance, and a visible runner summary before execution begins.

This also adds a timeout-based fallback for downloading remote longrun skill templates, which prevents `task-master init --with-codex` and `task-master codex init` from hanging when upstream templates are slow or unavailable.
