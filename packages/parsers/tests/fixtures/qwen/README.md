# Qwen parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | Gemini-style usageMetadata | 1 session, 2 messages, exact token counts incl. thoughts/cache |
| `missing-fields.jsonl` | Messages without usageMetadata | 1 session, usage unavailable |
| `corrupt.jsonl` | Invalid JSONL line | warnings + valid lines parsed |
