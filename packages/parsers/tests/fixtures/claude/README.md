# Claude parser fixtures

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | Minimal session with token usage | 1 session, 4 messages, `inputTokens` > 0, `outputTokens` > 0 |
| `missing-fields.jsonl` | Messages without `usage` blocks | 1 session, 2 messages; tokens may be text-estimated |
| `corrupt.jsonl` | One invalid JSONL line mid-file | 1 session, warnings for corrupt line, valid messages still parsed |

Legacy top-level `claude-session.jsonl` mirrors `valid.jsonl` for backward-compatible tests.
