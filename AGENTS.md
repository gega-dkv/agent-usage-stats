# Repository Guidelines

## Project Structure & Module Organization

This is a pnpm TypeScript monorepo for a local-first AI usage analyzer. Applications live in `apps/`: `apps/web` is the Next.js dashboard and `apps/cli` is the CLI. Reusable code lives in `packages/`: `core` handles scanning, `db` handles persistence, `parsers` reads Codex/Claude/Gemini formats, `pricing` calculates costs, `shared` contains shared types/schemas/utils, and `ui` contains chart components. Tests are under `packages/*/tests` and `apps/*/tests`; parser fixtures are in `packages/parsers/tests/fixtures`.

## Build, Test, and Development Commands

Use Node.js 20+ and pnpm 9+.

- `pnpm install` installs workspace dependencies.
- `pnpm dev` starts the web dashboard on port 3000.
- `pnpm build` builds packages and apps in dependency order.
- `pnpm cli -- <command>` runs the built CLI, for example `pnpm cli -- scan`.
- `pnpm lint` checks TypeScript and TSX files with ESLint.
- `pnpm lint:fix` applies safe ESLint fixes.
- `pnpm format` formats app and package TypeScript/JSON files with Prettier.
- `pnpm typecheck` runs `tsc --noEmit` across workspaces.
- `pnpm test:run` runs the Vitest suite once; `pnpm test` runs Vitest interactively.

## Coding Style & Naming Conventions

Write TypeScript as ES modules. Prefer named exports for shared package APIs and keep provider-specific logic in files named after the provider, such as `packages/parsers/src/codex.ts`. React components use `PascalCase` exports and established kebab-case filenames, for example `scan-button.tsx`. ESLint warns on unused variables, except underscore-prefixed parameters, and on `any`; avoid `any` unless it isolates unknown external data.

## Testing Guidelines

Vitest is configured with the Node environment and includes `packages/**/tests/**/*.test.ts` and `apps/**/tests/**/*.test.ts`. Name tests `*.test.ts` and keep fixtures small, explicit, and under the relevant package test directory. Add or update tests when changing parsers, pricing logic, shared schemas, or scan behavior. Run `pnpm test:run` before opening a pull request; use coverage locally with Vitest when touching broad logic.

## Commit & Pull Request Guidelines

The current history uses short, lowercase summary commits such as `first implementation` and `implementation plan`. Keep commit subjects concise and imperative or descriptive. Pull requests should include a brief problem/solution summary, test commands run, linked issues when applicable, and screenshots for dashboard UI changes. Note privacy or data-storage implications when changing config, prompt handling, database schema, or provider discovery.

## Security & Configuration Tips

Do not commit local databases, generated build output, or real session exports. Use `agent-usage.config.example.json` and `pricing.example.json` as templates, and keep personal config in untracked local files.
