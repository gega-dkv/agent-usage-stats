# Kimi CLI parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | StatusUpdate with token_usage | 1 session, exact tokens, default model kimi-for-coding |
| `missing-fields.jsonl` | zero token usage StatusUpdate | empty sessions + warning |
| `corrupt.jsonl` | invalid line | warnings + valid StatusUpdate parsed |
