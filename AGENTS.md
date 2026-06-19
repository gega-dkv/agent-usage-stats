# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm TypeScript monorepo for a local-first AI usage analyzer. Applications live in `apps/`:

- `apps/web` — Next.js dashboard (port 3000 in dev)
- `apps/cli` — CLI with bundled `web/` production build after `pnpm build`
- `apps/desktop` — Tauri v2 desktop shell (optional; `pnpm desktop:dev` / `desktop:build`)

Reusable code lives in `packages/`:

- `core` — scan pipeline (`scanSessions`)
- `db` — SQLite + Drizzle, FTS5, migrations (`schema_version` currently **3**)
- `parsers` — **19 provider parsers** + registry-driven discovery
- `pricing` — cost engine, bundled model table, model aliases
- `shared` — types, Zod schemas, **provider registry** (`providers.ts`)
- `ui` — chart components (consumed by the web app)

Tests: `packages/*/tests`, `apps/*/tests`. Parser fixtures: `packages/parsers/tests/fixtures/<provider>/`.

## Build, Test, and Development Commands

Use Node.js 20+ and pnpm 9+.

- `pnpm install` — install workspace dependencies
- `pnpm dev` — start the web dashboard on port 3000
- `pnpm build` — build packages and apps in dependency order (web → CLI bundle)
- `pnpm cli -- <command>` — run the built CLI, e.g. `pnpm cli -- scan`
- `pnpm desktop:dev` / `pnpm desktop:build` — Tauri desktop (requires Rust; see `apps/desktop/README.md`)
- `pnpm lint` / `pnpm lint:fix` — ESLint
- `pnpm format` — Prettier
- `pnpm typecheck` — `tsc --noEmit` across workspaces
- `pnpm test:run` — Vitest once; `pnpm test` — interactive

## Coding Style & Naming Conventions

Write TypeScript as ES modules. **Relative imports must use `.js` extensions** even in `.ts` source. Prefer named exports for shared package APIs. Provider-specific logic lives in `packages/parsers/src/<provider>.ts`. React components use `PascalCase` exports and kebab-case filenames (e.g. `scan-button.tsx`).

## Testing Guidelines

Vitest uses the Node environment. Name tests `*.test.ts`. Add or update tests when changing parsers, pricing, shared schemas, scan behavior, or CLI JSON contracts. Run `pnpm test:run` before opening a PR. See `CONTRIBUTING.md` for parser fixture and schema-change workflows.

## Commit & Pull Request Guidelines

Use conventional commits where possible (`feat`, `fix`, `chore`, `docs`, `test`). Keep subjects concise and imperative. PRs should include problem/solution summary, test commands run, linked issues when applicable, and screenshots for dashboard UI changes. Note privacy or data-storage implications when changing config, prompt handling, database schema, or provider discovery.

## Security & Configuration Tips

- All data stays local; no telemetry by default
- Do not commit local databases, generated build output (`.next`, `apps/cli/web/`), or real session exports
- Use `agent-usage.config.example.json` and `pricing.example.json` as templates
- DB path: `config.dbPath` → `AGENT_USAGE_DB_PATH` → `~/.config/agent-usage-stats/stats.db`
