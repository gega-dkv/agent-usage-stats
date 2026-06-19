# Factory Droid parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.settings.json` | session-level usage block | 1 session, exact tokens incl. thinking/cache |
| `missing-fields.settings.json` | messages without usage | warning, no token totals |
| `corrupt.settings.json` | invalid JSON | error warning |
