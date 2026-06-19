# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A complementary `AGENTS.md` exists with conventions for commits, testing, and style. This file focuses on architecture and the workflows that require reading multiple files to understand.

## Commands

Node 20+ and pnpm 9+ required.

- `pnpm install` — install workspace deps
- `pnpm dev` — Next.js dashboard on port 3000 (`@agent-usage/web`)
- `pnpm build` — builds packages then apps **in an explicit dependency order** (see `package.json`); order matters because packages import each other's compiled `dist/`
- `pnpm cli -- <cmd>` — run the built CLI, e.g. `pnpm cli -- scan`, `pnpm cli -- stats --day`, `pnpm cli -- prompts --search "x"`, `pnpm cli -- pricing list`
- `pnpm lint` / `pnpm lint:fix` — ESLint over `apps/**` and `packages/**`
- `pnpm format` — Prettier
- `pnpm typecheck` — `tsc --noEmit` across all workspaces (`pnpm -r typecheck`)
- `pnpm test` (interactive) / `pnpm test:run` (once) — Vitest from the repo root via the root `vitest.config.ts`

Run a single test file: `pnpm test:run packages/parsers/tests/parsers.test.ts`. Run by name: `pnpm test:run -t "claude parser"`.

## Architecture

pnpm monorepo. Apps in `apps/` (`cli`, `web`), libraries in `packages/`. Workspace packages are referenced as `@agent-usage/<name>`. Source is ESM TypeScript — **relative imports must use `.js` extensions** (e.g. `import { claudeParser } from './claude.js'`) even though the source is `.ts`.

### The scan pipeline (the core data flow)

`packages/core/src/scan.ts` (`scanSessions`) orchestrates everything and is the best entry point for understanding the system:

1. `discoverSessionFiles` (`packages/parsers/src/discovery.ts`) globs provider session files from default or configured paths.
2. For each file, `getParserForFile` picks a parser by calling each parser's `canParse(filePath, sample)` (first 4 KB sample).
3. The parser's `parse()` returns `NormalizedSession[]` + `ParserWarning[]`, gated by the configured `privacyMode` (controls how much prompt content is stored).
4. Sessions/messages are upserted into SQLite; per-session cost is computed via `lookupPricing` + `calculateCost` (`packages/pricing`).
5. `refreshUsageRollups` rebuilds the `usage_daily` / `usage_monthly` / `usage_yearly` aggregate tables. These rollups are what the dashboard and `stats` command read — **they are derived and only refreshed at the end of a scan**, not on the fly.

`NormalizedSession` / `NormalizedMessage` / `TokenTotals` in `packages/shared/src/types.ts` are the canonical shapes every parser must produce.

### Adding a provider

1. New parser in `packages/parsers/src/<provider>.ts` implementing the `ProviderParser` interface (`canParse` + `parse`).
2. Register it in the `parsers` array in `packages/parsers/src/index.ts`.
3. Add default discovery paths + label in `packages/parsers/src/discovery.ts` (`DEFAULT_PATHS`, `PROVIDER_LABELS`), and update `detectProvider` if path/content detection is needed.
4. Add the provider to the `Provider` union in `packages/shared/src/types.ts` and map it to a `PricingProvider` (`providerToPricingProvider` in shared).

### Database (`packages/db`)

SQLite via `better-sqlite3` + Drizzle. **The schema is defined in two places that must be kept in sync manually — there are no migrations.** `schema.ts` is the Drizzle table definitions used for typed queries, while `connection.ts` (`initializeDatabase`) holds the raw `CREATE TABLE IF NOT EXISTS` DDL that actually creates the tables. When changing the schema, edit both. Some writes in `scan.ts` use raw `sqlite.prepare(...)` rather than Drizzle.

DB path resolution order: `config.dbPath` → `AGENT_USAGE_DB_PATH` env → `~/.config/agent-usage-stats/stats.db` (`XDG_CONFIG_HOME` aware). Query helpers live in `queries.ts` and are consumed by both the CLI and the web API routes.

### Web app (`apps/web`)

Next.js App Router. SQLite access is server-only: `apps/web/src/lib/db-server.ts` lazily dynamic-imports `@agent-usage/db` and `@agent-usage/core` and caches the DB instance, so `better-sqlite3` never reaches the client bundle. API routes under `apps/web/src/app/api/*` (scan, stats, sessions, prompts, pricing, providers, privacy) are the bridge between the UI and the packages. Note: chart components are duplicated in `packages/ui/src/charts` and `apps/web/src/components/charts` — confirm which set a change should target.

### Config

`loadConfig` (`packages/core/src/scan.ts`) reads `agent-usage.config.json` (or `.agent-usage.config.json` / `.jsonc`) from cwd, merged over `getDefaultConfig()`. See `agent-usage.config.example.json` and `pricing.example.json` for templates. Pricing/cost figures are simulated API-equivalent estimates, not billed amounts.
