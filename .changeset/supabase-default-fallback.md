---
"task-master-ai": patch
---

Fix Hamster authentication bootstrap by adding built-in Supabase fallback defaults for the official hosted environment.

This prevents `tm auth login` from failing with missing Supabase env errors in self-built or custom-published packages when Supabase variables are not explicitly provided.
