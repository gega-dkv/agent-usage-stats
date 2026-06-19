# Amp parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.json` | thread messages + usage ledger | 1 session, exact tokens, credits in metadata |
| `missing-fields.json` | messages without usage | metadata-only / unavailable usage |
| `corrupt.json` | invalid JSON | error warning, no sessions |
