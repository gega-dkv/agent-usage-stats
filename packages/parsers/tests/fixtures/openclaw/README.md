# OpenClaw parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | model_change + messages + cost.total | 1 session, recorded cost aggregated |
| `missing-fields.jsonl` | model snapshot only | messages without usage |
| `corrupt.jsonl` | corrupt middle line | warnings, valid records kept |
