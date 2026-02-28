---
"task-master-ai": patch
---

Ensure published npm packages are built at publish time by running `build` in `prepack`.

This prevents stale `dist` artifacts and keeps CLI-reported version output aligned with the published package version.
