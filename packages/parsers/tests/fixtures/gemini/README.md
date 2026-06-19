# Gemini parser fixtures

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.json` | Chat export with `usageMetadata` | 1 session, 4 messages, positive token totals |
| `missing-fields.json` | Messages without `usageMetadata` | 1 session, 2 messages, zero or estimated token totals |
| `corrupt.json` | Truncated/invalid JSON | 0 sessions, parser warning, no crash |

Legacy top-level `gemini-chat.json` mirrors `valid.json`.
