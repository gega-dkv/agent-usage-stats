# Crush parser fixtures (synthetic, detection-only)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.json` | crush config | detected-only warning, zero sessions |
| `missing-fields.json` | empty config | detected-only warning |
| `corrupt.json` | invalid JSON | detected-only warning (canParse may still match path) |

Crush never parses token usage until a stable public schema exists.
