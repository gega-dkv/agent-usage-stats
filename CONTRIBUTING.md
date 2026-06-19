# Contributing

Thank you for contributing to Agent Usage Stats. This guide covers the workflows most contributors touch: parser fixtures, schema changes, and provider registration.

## Prerequisites

- Node.js 20+, pnpm 9+
- From a clean checkout: `pnpm install && pnpm build`

Run before opening a PR:

```bash
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build
```

## Adding or updating a provider parser

1. **Register the provider** in `packages/shared/src/providers.ts` (`PROVIDER_REGISTRY`) and add its id to the `Provider` union in `packages/shared/src/types.ts`.
2. **Implement the parser** in `packages/parsers/src/<provider>.ts` (`canParse` + `parse`), then register it in `packages/parsers/src/index.ts`.
3. **Add fixtures** under `packages/parsers/tests/fixtures/<provider>/`:
   - `valid/` — representative session file(s) that parse successfully
   - `missing-fields/` — records with absent usage fields (parser must not crash)
   - `corrupt/` — malformed input (parser must warn, not throw)
   - `README.md` — note whether fixtures are synthetic and how to reproduce real exports
4. **Add tests** in `packages/parsers/tests/` (see `phase2-parsers.test.ts` for patterns).
5. **Update example config** — ensure `agent-usage.config.example.json` includes the provider entry if it is new.

Path patterns in the registry use `~` and `$ENV` placeholders; the discovery layer expands them at runtime. Do not hardcode provider lists in the CLI or web app — derive from the registry.

### Prompt-history-only providers

Providers with `supportLevel: 'prompt-history-only'` (Aider, Cursor CLI, SpecStory) store session metadata but **never invent token counts**. Optional text-based estimation runs only when `estimatePromptOnlySources: true` in config. Tests must assert tokens stay zero when estimation is disabled.

### SQLite-backed providers

- Open provider databases **read-only** via `openProviderDatabase()` in `@agent-usage/db`.
- Add `inspect-schema` coverage if the provider uses SQLite (OpenCode, Goose, Kilo, Hermes).
- Document fixture source in the provider README; never commit real session exports with prompt content.

### Detection-only providers

Crush is registered with a parser stub that performs detection only — no usage ingestion. Tests should assert `detected-only` behavior.

## Parser fixture guidelines

- Keep fixtures **small** and **synthetic** unless anonymized real samples are essential.
- One concern per fixture directory (`valid`, `missing-fields`, `corrupt`).
- Prefer JSONL for line-oriented providers; single JSON/SQLite files when that matches the tool.
- For Copilot OpenTelemetry fixtures, document required env vars in the fixture README (see `packages/parsers/tests/fixtures/copilot/README.md`).

## Database schema changes

The schema is defined in **three places** that must stay aligned:

| File | Role |
|------|------|
| `packages/db/src/schema.ts` | Drizzle table definitions for typed queries |
| `packages/db/src/connection.ts` | Raw `CREATE TABLE IF NOT EXISTS` DDL for new databases |
| `packages/db/src/migrations.ts` | Incremental upgrades; bump `CURRENT_SCHEMA_VERSION` |

When adding columns or tables:

1. Edit `schema.ts` and `connection.ts`.
2. Add a migration step in `migrations.ts` for existing `stats.db` files.
3. Increment `CURRENT_SCHEMA_VERSION` (currently **3**).
4. Document the version in README / IMPLEMENTATION_PLAN if user-visible.
5. Add or update tests under `packages/db/tests/` and any scan integration tests affected.

Some writes in `packages/core/src/scan.ts` use raw `sqlite.prepare(...)` — update those if new columns are written during scan.

## Config and pricing examples

- `agent-usage.config.example.json` — all 19 providers, privacy toggles, `resimulateRecordedCosts`, `estimatePromptOnlySources`, `modelAliases`.
- `pricing.example.json` — `{ "models": [...], "modelAliases": {...} }` format accepted by `pricing import`.

Costs are **simulated API-equivalent estimates**, not billed amounts. Do not add runtime pricing fetch.

## Web and CLI changes

- Every CLI command must support `--json` (see `apps/cli/tests/cli-json-contracts.test.ts`).
- Web API routes live under `apps/web/src/app/api/*`; add contract tests in `apps/web/tests/` when changing response shapes.
- Chart components live in `packages/ui` — the web app imports from there (Phase 7 consolidation).

## Pull requests

- Brief problem/solution summary
- Test commands run
- Note privacy or schema implications when touching parsers, config, or DB
- Screenshots for dashboard UI changes

See also `AGENTS.md` (repo conventions) and `CLAUDE.md` (architecture deep dive).
