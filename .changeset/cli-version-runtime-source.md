---
"task-master-ai": patch
---

Fix CLI version reporting to always use Task Master's runtime package version.

`task-master --version` no longer depends on `TM_PUBLIC_VERSION` build-time injection, preventing stale version output after publishing and global installs.
