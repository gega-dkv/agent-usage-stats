# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A complementary `AGENTS.md` exists with conventions for commits, testing, and style. `CONTRIBUTING.md` covers parser fixtures and schema migrations. This file focuses on architecture and multi-file workflows.

## Commands

Node 20+ and pnpm 9+ required.

- `pnpm install` — install workspace deps
- `pnpm dev` — Next.js dashboard on port 3000 (`@agent-usage/web`)
- `pnpm build` — builds packages then apps **in explicit dependency order** (see root `package.json`); builds web, bundles into `apps/cli/web`, then CLI
- `pnpm cli -- <cmd>` — built CLI: `scan`, `sync`, `stats`, `prompts`, `providers`, `doctor`, `inspect-schema`, `dashboard`, etc.
- `pnpm desktop:dev` / `pnpm desktop:build` — Tauri app (`apps/desktop`); embeds CLI dashboard on `127.0.0.1:3847`
- `pnpm lint` / `pnpm lint:fix` — ESLint over `apps/**` and `packages/**`
- `pnpm format` — Prettier
- `pnpm typecheck` — `tsc --noEmit` across workspaces
- `pnpm test:run` / `pnpm test` — Vitest from repo root

Single test file: `pnpm test:run packages/parsers/tests/parsers.test.ts`. By name: `pnpm test:run -t "claude parser"`.

## Architecture

pnpm monorepo. Apps in `apps/` (`cli`, `web`, `desktop`), libraries in `packages/`. Workspace packages: `@agent-usage/<name>`. Source is ESM TypeScript — **relative imports must use `.js` extensions**.

### Provider registry (single source of truth)

`packages/shared/src/providers.ts` defines all **19 providers**: support level, default usage confidence, storage kinds, default paths, env overrides, and `hasParser`. Discovery, CLI `providers`/`doctor`, web Providers page, and Zod config schemas derive from this registry — do not duplicate provider lists elsewhere.

### The scan pipeline

`packages/core/src/scan.ts` (`scanSessions`):

1. `discoverSessionFiles` (`packages/parsers/src/discovery.ts`) globs session files using registry paths.
2. `getParserForFile` picks a parser via `canParse(filePath, sample)` (first 4 KB).
3. Parser `parse()` returns `NormalizedSession[]` + `ParserWarning[]`, gated by `privacyMode` and `estimatePromptOnlySources`.
4. Sessions/messages upserted to SQLite; costs via `lookupPricing` + `calculateCost` (`packages/pricing`).
5. `refreshUsageRollups` rebuilds `usage_daily` / `usage_monthly` / `usage_yearly` — **only at end of scan**.

Canonical types: `NormalizedSession`, `NormalizedMessage`, `TokenTotals` in `packages/shared/src/types.ts`.

### Adding a provider

1. Entry in `PROVIDER_REGISTRY` + `Provider` union in `types.ts`.
2. Parser in `packages/parsers/src/<provider>.ts`, register in `packages/parsers/src/index.ts`.
3. Fixtures under `packages/parsers/tests/fixtures/<provider>/` + tests.
4. Map to `PricingProvider` if needed. See `CONTRIBUTING.md`.

Prompt-history-only providers (Aider, Cursor, SpecStory) never invent tokens unless `estimatePromptOnlySources` is enabled. Crush is detection-only.

### Database (`packages/db`)

SQLite via `better-sqlite3` + Drizzle. Schema in **two places** (keep in sync): `schema.ts` (Drizzle) and `connection.ts` (DDL). Migrations in `migrations.ts`; **`CURRENT_SCHEMA_VERSION` is 3**, stored in `settings.schema_version`.

DB path: `config.dbPath` → `AGENT_USAGE_DB_PATH` → `~/.config/agent-usage-stats/stats.db`. Query helpers in `queries.ts` — used by CLI and web API routes.

### Web app (`apps/web`)

Next.js App Router. SQLite is server-only: `apps/web/src/lib/db-server.ts` lazy-imports `@agent-usage/db` and `@agent-usage/core`. API routes under `apps/web/src/app/api/*`. Charts import from `@agent-usage/ui`.

### CLI distribution

`apps/cli` publishes as `@agent-usage/cli`. `dashboard` serves bundled `apps/cli/web` (copied from `apps/web/.next` at build time). Binds `127.0.0.1` by default.

### Config

`loadConfig` reads `agent-usage.config.json` (or `.agent-usage.config.json` / `.jsonc`) merged over `getDefaultConfig()`. Templates: `agent-usage.config.example.json`, `pricing.example.json`. Costs are simulated API-equivalent estimates, not billed amounts.
