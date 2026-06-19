# pi-agent parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | JSONL usage records | 1 session, exact tokens |
| `valid.json` | JSON messages array | 1 session, exact tokens |
| `missing-fields.jsonl` | prompt text only | metadata-only usage |
| `corrupt.jsonl` | invalid line | warnings + valid records |
