# SpecStory parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.md` | frontmatter + User/Assistant sections | 1 session, optional token text metadata |
| `missing-fields.md` | prompt-history-only | metadata-only unless estimation enabled |
| `corrupt.md` | malformed frontmatter | still parses sections |
