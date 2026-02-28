---
"task-master-ai": patch
---

Harden structured output schema normalization for Codex/OpenAI strict JSON schema validation.

Task Master now enforces that object schemas list every declared property in `required`, in addition to ensuring `additionalProperties: false`.

This fixes `parse-prd` failures with `codex-cli` + `gpt-5.3-codex` where providers rejected schemas with errors like:
- Missing `additionalProperties: false`
- `required` missing keys such as `metadata`
