---
"@hhsw2015/task-master-ai": patch
---

Fix legacy `storage.type = "local"` compatibility so CLI commands no longer fail with `Unknown storage type: local`.

- Normalize legacy `local` storage type to `file` in runtime config resolution.
- Add defensive normalization in storage factory creation/validation paths.
- Add regression tests to prevent initialization failures in older project configs.
