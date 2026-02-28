---
"task-master-ai": patch
---

Make CLI version resolution runtime-safe by reading package metadata from the installed Task Master package instead of relying on build-baked constants.

This keeps `task-master --version` aligned with the installed package version even when stale build artifacts are present.
