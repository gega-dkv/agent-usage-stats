# Aider parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.aider.chat.history.md` | chat history with token/cost text markers | exact tokens from text, no estimation by default |
| `missing-fields.aider.chat.history.md` | prompts without markers | metadata-only, warning when estimation disabled |
| `corrupt.aider.chat.history.md` | irregular markdown | still parses blocks without crashing |
