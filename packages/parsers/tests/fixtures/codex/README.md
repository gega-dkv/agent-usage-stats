# Codex parser fixtures

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | Session with prompt/completion token usage | 1 session, 4 messages, positive input/output totals |
| `missing-fields.jsonl` | Messages without `usage` | 1 session, 2 messages; tokens may be text-estimated |
| `corrupt.jsonl` | Invalid line between valid records | 1 session, parser warnings, partial ingest |
| `events-valid.jsonl` | Real Codex event JSONL (`session_meta`, `turn_context`, `token_count`) | 1 session, final token_count totals, model from `turn_context` |
| `events-missing-tokens.jsonl` | Event JSONL without any `token_count` | 1 session, no tokens, `missing-token-fields` warning |
| `events-corrupt.jsonl` | Invalid line between valid event records | 1 session, parser warnings, token usage ingested |

Legacy top-level `codex-session.json` mirrors `valid.jsonl` (same JSONL content, `.json` extension).
