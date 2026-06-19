# Codebuff parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.json` | nested metadata.usage paths | 1 session, exact tokens |
| `missing-fields.json` | messages without usage metadata | warning missing-token-fields |
| `corrupt.json` | truncated JSON | error warning |
