# Codex parser fixtures

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | Session with prompt/completion token usage | 1 session, 4 messages, positive input/output totals |
| `missing-fields.jsonl` | Messages without `usage` | 1 session, 2 messages; tokens may be text-estimated |
| `corrupt.jsonl` | Invalid line between valid records | 1 session, parser warnings, partial ingest |

Legacy top-level `codex-session.json` mirrors `valid.jsonl` (same JSONL content, `.json` extension).
