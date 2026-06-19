# Implementation Plan

This project is currently a usable prototype, not acceptance-ready. The main gaps are validation/schema drift, missing desktop packaging, incomplete CLI `--json` coverage, and several data integrity/privacy details that need to be made explicit.

## Progress Snapshot

| Area | Status |
|------|--------|
| Phase 0: Make the repo honest | **Done** — typecheck, CI, web runtime warnings |
| CI (lint, typecheck, test, build) | **Done** — `.github/workflows/ci.yml` |
| `@agent-usage/ui` in build/typecheck | **Done** — root `package.json` |
| Provider registry (19 agents) | **Done** — `packages/shared/src/providers.ts` |
| Parsers (Claude, Codex, Gemini) | **Done** |
| Phase 2: Provider Expansion (16 parsers) | **Done** — all registry providers wired except detection-only Crush usage |
| SQLite FTS + rollups | **Done** |
| Stats CLI (day/month/year, ranges, summary) | **Done** |
| Provider CLI (`providers`, `detect`, `doctor`, `inspect-schema`) | **Done** |
| Deduplication (full-file SHA-256) | **Mostly done** — see Phase 1.4 |
| Pricing fallback flags (`cost_estimated`, `recorded_cost`) | **Done** — config + scan wiring |
| Incremental scan (mtime + hash skip) | **Done** — `scanned_files` table |
| Zod schemas + example config vs registry | **Done** — Phase 1.0 |
| Phase 1.0: Schema, config, migration | **Done** |
| Phase 1.1: Normalized types + persistence | **Done** |
| CLI `--json` on all commands | **Done** — Phase 3.1 |
| Phase 3: CLI Contract Completion | **Done** |
| Phase 4: Web App Completion | **Done** — dashboard, prompts, sessions, pricing, settings, providers |
| Phase 5: Pricing And Aliases | **Done** — local bundled pricing, model aliases, provider fallbacks |
| Phase 8.1: CLI/npm distribution | **Done** — publishable `@agent-usage/cli`, bundled web dashboard, Homebrew template |
| Phase 8.2: Tauri desktop | **Scaffolded** — `apps/desktop`, `pnpm desktop:dev` / `desktop:build`; CI desktop build optional |
| Desktop (`apps/desktop`) | **Scaffolded** — see `apps/desktop/README.md` for Rust/Tauri prerequisites |

---

## Non-Goals (Out of Scope)

The following are explicitly **not** planned for acceptance-ready v1:

- **Billing API sync** — no OpenAI/Anthropic/Google invoice or usage API integration; costs are simulated from local session data and editable pricing tables.
- **Budgets and alerts** — no spend thresholds, email/push notifications, or quota enforcement.
- **Cloud sync / team features** — no multi-user accounts, shared databases, or remote aggregation.
- **Real invoice reconciliation** — provider-recorded costs are best-effort from session logs, not audited against billing statements.

Provider evaluation backlog (not in v1 registry): Windsurf, Cline, Continue, Roo Code, Amazon Q Developer, Zed AI.

---

## Phase 0: Make The Repo Honest

**Done.**

1. ~~Fix `pnpm typecheck`.~~ **Done.**
   - ~~Remove unused `React` imports from `packages/ui/src/charts/*` if any remain.~~ Charts use JSX without unused React imports.
   - ~~Add `@agent-usage/ui` to the root `typecheck` and `build` scripts~~ **Done.**

2. ~~Add CI.~~ **Done.**
   - ~~Create GitHub Actions workflow for `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, and `pnpm build`.~~
   - ~~Cache pnpm store.~~

3. ~~Fix web runtime warnings.~~ **Done.**
   - ~~Resolve the React `<title>` warning observed in the Next.js dev server.~~ Replaced SVG `<title>` children in heatmap cells with `aria-label`; root layout uses App Router `metadata` export (no duplicate `<title>`).

---

## Phase 1: Data Correctness

### Phase 1.0: Schema, Config, and Migration Alignment *(done)*

1. Align validation with the 19-provider registry. **Done.**
   - Extend `providerSchema` and `appConfigSchema` in `packages/shared/src/schemas.ts` to all registered providers (derive from `PROVIDER_REGISTRY` where possible).
   - Extend `pricingProviderSchema` for `qwen`, `moonshot`, and `other`.
   - Update `getDefaultConfig()` to build per-provider entries from the registry defaults.
   - Update `agent-usage.config.example.json` with all toggles: `resimulateRecordedCosts`, `estimatePromptOnlySources`, and optional per-provider enable/path overrides.

2. Add DB schema versioning and upgrade path. **Done** — `schema_version` 3; migrations for Phase 1.1 columns + `scanned_files`.

3. Validate config at load time. **Done** — Zod parse in `loadConfig()` with stderr warnings; `validateConfig()` for `doctor`.

### Phase 1.1: Normalized Types and Persistence

1. Expand normalized provider types.
   - ~~Add `Provider` union for all 19 providers~~ **Done** in `types.ts`.
   - ~~Add `ProviderSupportLevel` and `UsageConfidence`~~ **Done** in `providers.ts`; **persisted** on sessions/messages + DB columns.
   - Add expanded token fields: `cacheCreationTokens`, `cacheReadTokens`, `toolTokens`. **Done.**
   - Add `CostTotals` with recorded cost, simulated cost, pricing source, currency, and estimated flag. **Done.**
   - Add `sourcePath`, `storageKind`, `supportLevel`, `usageConfidence`, `messageCount`, `promptCount`, `warnings`, and `rawRetention` to normalized sessions. **Done.**
   - Add `contentHidden`, provider id, usage confidence, total tokens, recorded cost, simulated cost, and metadata to normalized messages. **Done.**

2. Replace the parser interface. **Done (minimal)** — `DiscoveredSource`, `ParseOptions`, optional `discover()` on `ProviderParser`; existing `canParse(path, sample)` retained for backward compatibility.

3. Expand parser warning model. **Done** — typed codes + DB column; Claude/Codex/Gemini set codes; `sqlite-locked` stub for Phase 2 provider DBs.

4. Fix deduplication. **Done**
   - ~~Hash the full file content~~ **Done** — SHA-256 of entire file in `scan.ts`.
   - Unique index on `(provider, file_hash, id)` **Done** — session upsert uses provider-stable session `id` as primary key; `file_hash` records provenance and detects file changes on re-scan.
   - Keep duplicate sessions ignored, not fatal.
   - Document multi-session-per-file behavior explicitly in tests (`multi-session.jsonl` fixture).

5. Add durable estimation flags. **Done** — `token_usage_estimated`, `usage_confidence` on sessions/messages.

6. Preserve pricing fallback status. **Done** — `resimulateRecordedCosts` wired through scan; `pricing_source` persisted.

7. ~~Implement SQLite full-text search.~~ **Done.**
   - FTS5 `messages_fts` with LIKE fallback; purge via `privacy purge-content`.
   - Keep FTS empty when privacy mode is `disabled`.

8. Stream large files. **Done (JSONL)** — Claude and Codex JSONL parsers stream line-by-line; incremental skip via `scanned_files` (mtime + hash). JSON array/object Codex and Gemini still load whole file (small typical size).

9. SQLite lock handling. **Done (stub)** — `openProviderDatabase()` in `@agent-usage/db` returns `sqlite-locked` warning; Phase 2 parsers should use it.

10. Surface quality metadata. **Done** — `getStatsSummary` includes `costEstimatedSessions`, `tokenEstimatedSessions`, `sessionsBySupportLevel`, `sessionsByUsageConfidence`; web sessions list/detail and `/api/sessions` expose `usageConfidence`, `costEstimated`, `supportLevel`.

---

## Phase 2: Provider Expansion

**Done** — 19/19 registry providers wired; Crush is detection-only (no usage parsing).

1. ~~Add provider registry.~~ **Done.**
2. ~~OpenCode parser.~~ **Done** — SQLite + legacy JSON fixtures.
3. ~~Qwen Code parser.~~ **Done**
4. ~~Goose parser.~~ **Done**
5. ~~Factory Droid parser.~~ **Done**
6. ~~Amp parser.~~ **Done**
7. ~~Codebuff parser.~~ **Done**
8. ~~Kimi CLI parser.~~ **Done**
9. ~~GitHub Copilot CLI OpenTelemetry parser.~~ **Done**
10. ~~OpenClaw parser.~~ **Done**
11. ~~Hermes Agent parser.~~ **Done**
12. ~~pi-agent parser.~~ **Done**
13. ~~Kilo parser.~~ **Done**
14. ~~Aider parser.~~ **Done** — prompt-history-only; respects `estimatePromptOnlySources`.
15. ~~Cursor CLI and SpecStory parser.~~ **Done**
16. ~~Crush detection.~~ **Done** — detection/doctor only.
17. ~~Provider fixtures.~~ **Done** — all providers have valid/missing-fields/corrupt/README (synthetic where noted).

---

## Phase 3: CLI Contract Completion

**Done.**

1. Add `--json` support to every command. **Done**
   - All commands including `pricing import/export`, `privacy status/set`, `watch`, `seed`, and `dashboard`.
   - `dashboard --json` emits `{ url, port, pid }`.

2. Complete stats behavior. **Done**
   - Daily, weekly, monthly, yearly rollups with `--from`/`--to`.
   - `--week` / `--granularity week` for weekly stats and export.
   - Summary includes most expensive model/day and top projects.

3. Improve `dashboard`. **Done**
   - Prefers built Next.js app in `node_modules/@agent-usage/web` or `apps/web/.next`.
   - Falls back to monorepo `pnpm dev`.
   - Binds to `127.0.0.1` by default.

4. Harden privacy commands. **Done**
   - `privacy purge-content` clears message content, FTS, and session metadata.
   - Reports purge counts in JSON and human output.

5. Document `sync` and `watch`. **Done**
   - README covers detection, non-TTY/JSON modes, and watch debounce.

6. ~~Add provider commands.~~ **Done**
   - `providers`, `providers detect`, `scan --provider`, `doctor --provider`, `inspect-schema`.

7. ~~Add schema inspection.~~ **Done** for OpenCode, Goose, Kilo, Hermes.

8. Export and scan history. **Done**
   - `stats export --format csv|json`, `sessions export`, `scan history`, `warnings` (all support `--json`).

---

## Phase 4: Web App Completion

**Done.**

1. **Dashboard** — time range (day/week/month/year/custom), group-by, metric selector, cost-by-model, real recent/expensive sessions, provider comparison, confidence filter, metadata-only warning. `/api/stats` supports week granularity and filters.
2. **Prompt viewer** — paginated default list, filters, session links, token/cost, view privacy toggle; prompt-history-only messaging.
3. **Sessions** — detail timeline, tool calls section, parser warnings; sort by provider/model.
4. **Pricing** — custom models, profile selector, clone profile, editable cached/reasoning rates, last updated.
5. **Settings** — provider toggles/paths, raw retention, estimation fallback, currency, rescan/rebuild rollups.
6. **Providers** — warnings, last scan, exact vs metadata-only counts.
7. **Web API & UX** — `apps/web/tests/api-queries.test.ts`; async scan + polling; bind to `127.0.0.1`.

**Deferred:** HTTP-level Next.js route integration tests; shadcn migration (Phase 7).

<details>
<summary>Original Phase 4 checklist</summary>

1. Dashboard.
   - Add time range switcher: day, week, month, year, custom.
   - Add group-by: provider, model, project, role.
   - Add metric selector: tokens, input, output, cached, reasoning, cost, prompts, sessions.
   - Add cost by model.
   - Add real recent sessions.
   - Add real most expensive sessions.

2. Prompt viewer.
   - List all user prompts without requiring search.
   - Add filters for provider, model, project, and date.
   - Add click-through conversation context.
   - Show prompt/session token usage and simulated cost.
   - Add view privacy toggle: full, preview, hidden stats-only.

3. Sessions page.
   - Add session detail route (`/sessions/[id]`) and `GET /api/sessions/[id]`.
   - Show conversation timeline.
   - Show tool calls separately.
   - Show parser warnings.
   - Add sorting by provider and model.

4. Pricing page.
   - Add custom model creation.
   - Add profile selector (`PricingProfile` including `subscription-equivalent`).
   - Add clone pricing profile.
   - Add editable cached input and reasoning prices.
   - Show last updated date.

5. Settings page.
   - Add provider paths.
   - Add enable/disable provider toggles.
   - Add raw retention setting.
   - Add token estimation fallback setting (`estimatePromptOnlySources`).
   - Add currency display preference.
   - Add rescan and rebuild indexes actions.

6. Providers page.
   - List all providers.
   - Show detected/not detected state.
   - Show default paths and env override.
   - Show support level.
   - Show last scan.
   - Show warnings.
   - Show number of sessions found.
   - Show number of sessions with exact usage.
   - Show number of metadata-only sessions.

7. Dashboard provider confidence updates.
   - Add provider comparison chart.
   - Add usage confidence filter: exact, cumulative-delta, provider-recorded-cost, estimated-from-text, metadata-only, unavailable.
   - Add unsupported/metadata-only sessions warning card.

8. Prompt viewer provider confidence updates.
   - For prompt-history-only providers with privacy disabled, show timestamp, provider, project, session, and content hidden.
   - When token data is unavailable, show “No reliable token usage found for this source.”

9. Web API and UX. *(new)*
   - Add web API contract tests (mirror CLI JSON tests).
   - Show scan progress during long scans.
   - Bind dev/prod server to localhost.

</details>

---

## Phase 5: Pricing And Aliases

**Done.**

1. Keep bundled pricing snapshot local. **Done**
   - No runtime fetch of pricing; bundled defaults + SQLite DB only.
   - `pricing.example.json` and bundled `DEFAULT_PRICING_MODELS` remain user-editable; CLI import accepts array or `{ "models": [...] }`.

2. Add model aliases. **Done**
   - OpenAI/Codex, Anthropic, Gemini/Google/Vertex/OpenRouter, Qwen, Moonshot/Kimi aliases in `packages/pricing/src/aliases.ts`.
   - Provider-prefixed names (`anthropic/...`, `openrouter/...`, `google/...`, Vertex `models/...`).
   - Config overrides via `modelAliases` in `agent-usage.config.json`; `lookupPricing` resolves aliases before fallback.

3. Support provider-specific pricing behavior. **Done**
   - Reasoning tokens use output-side pricing by default (not marked estimated).
   - Recorded vs simulated cost separation unchanged from Phase 1.
   - Unknown models fall back to provider default with `isEstimated: true`.
   - `subscription-equivalent` profile documented in engine comments + README.

---

## Phase 6: Privacy Completion **Done**

1. Enforce privacy defaults across all new providers. **Done**
   - Store token/cost metadata by default.
   - Do not store prompt text by default.
   - Do not store assistant text by default.
   - Do not store raw records by default.
   - Only keep prompt content in memory during parsing when required for enabled estimation.
   - Respect purge command for every parser and storage path.

2. Add prompt-only estimation setting. **Done**
   - Add `estimatePromptOnlySources`.
   - Keep it disabled by default.
   - Use it only for sources such as Aider, Cursor, and SpecStory when no structured usage exists.

---

## Phase 7: shadcn/ui And UI Package — **Done**

1. Initialize shadcn/ui properly. **Done**
   - Add `components.json`.
   - Add required shadcn dependencies and base components.
   - Use shadcn primitives where appropriate.

2. Consolidate chart usage. **Done**
   - Use `packages/ui` chart primitives from the web app instead of duplicate local chart implementations.
   - Verify all charts support dark mode, responsive sizing, empty states, keyboard focus, tooltips, compact numbers, and currency formatting.

3. Complete required chart primitives. **Done**
   - `UsageLineChart`
   - `UsageBarChart`
   - `CostStackedBarChart`
   - `ProviderDonutChart`
   - `CalendarHeatmap`
   - `ModelCostRanking`

---

## Phase 8: Distribution and Desktop Packaging

### Phase 8.1: CLI and npm Distribution *(done)*

1. ~~Publish `@agent-usage/cli` for global install (`npm install -g`, `pnpm add -g`, `npx agent-usage`).~~ **Done** — `apps/cli/package.json` has `bin`, `files`, `exports`, `publishConfig`; bundled `web/` via `scripts/bundle-web.mjs`.
2. ~~Bundle or ship built web assets so `dashboard` works outside a git checkout.~~ **Done** — root `pnpm build` builds web then CLI; `resolveWebAppTarget()` prefers `apps/cli/web`.
3. ~~Add Homebrew formula (macOS) as optional install path.~~ **Done** — `Formula/agent-usage.rb` + `docs/HOMEBREW.md` (template only, no tap).
4. ~~Document Windows/Linux path verification milestones (macOS first).~~ **Done** — README platform notes.

### Phase 8.2: Tauri Desktop App *(scaffolded)*

1. ~~Add Tauri app.~~ **Scaffolded**
   - ~~Create `apps/desktop`.~~ **Done**
   - ~~Wire `pnpm desktop:dev` and `pnpm desktop:build`.~~ **Done** — root `package.json`
   - ~~Use OS app data directory for SQLite and settings.~~ **Done** — `AGENT_USAGE_DB_PATH` via Tauri `app_data_dir`
   - ~~Do not expose a public network server.~~ **Done** — binds `127.0.0.1` only

2. Keep desktop local-first.
   - Offline operation: dashboard served locally; no network required.
   - macOS path verification: same provider registry as CLI (Windows/Linux via path abstraction — manual QA pending).
   - Full release bundling (sidecar CLI + icons): follow `apps/desktop/README.md`; CI desktop job optional.

---

## Phase 9: Tests

1. Add integration test for scan -> DB -> dashboard query (include temp DB fixture setup). **Done**
2. Add CLI JSON contract tests for all commands. **Done**
3. Add web API contract tests. **Done**
4. Add privacy mode tests.
   - Fresh install stores no prompt content. **Done**
   - Preview/full/raw only affect future scans unless rescanned. **Done**
   - Purge removes stored prompt/response/raw content. **Done**
5. Add parser robustness tests.
   - Corrupt files. **Done**
   - Unknown records. **Done**
   - Missing usage fields. **Done**
   - Duplicate sessions. **Done**
   - Large JSONL files. **Done**
6. Add provider parser tests.
   - **Every** provider (including Claude, Codex, Gemini) has fixture-backed tests per Phase 2.17. **Done**
   - Every parser handles missing/corrupt files without crashing. **Done**
   - SQLite provider tests assert source DBs are opened read-only. **Done**
   - OpenCode tests cover SQLite and legacy JSON. **Done**
   - Copilot tests cover OpenTelemetry enabled and missing-export states. **Done**
   - Crush tests cover detected-only behavior. **Done**
   - Aider, Cursor, and SpecStory tests assert token usage is not invented unless estimation is explicitly enabled. **Done**
7. Add CLI command tests under `apps/cli/tests`. **Done**

---

## Phase 10: Documentation

1. Complete README.
   - Install instructions (git checkout, global CLI, Homebrew when available).
   - Full CLI examples.
   - `sync` and `watch` command behavior.
   - Web app usage.
   - Desktop roadmap and commands.
   - Screenshots placeholder section.
   - Security and privacy model.
   - How to add a new provider.
   - Explicit non-goals section (link to above).

2. Update examples and contributor docs.
   - Verify `pricing.example.json`.
   - Verify `agent-usage.config.example.json` (all 19 providers + new toggles).
   - Add notes about simulated API-equivalent costs.
   - Add provider matrix with support level and usage confidence notes.
   - Document Copilot OpenTelemetry setup.
   - Document schema inspection commands.
   - Document prompt-history-only providers and estimation behavior.
   - Sync `AGENTS.md` and `CLAUDE.md` with final architecture.
   - Add contributing guide for parser fixtures and schema changes.
   - Fix placeholder GitHub URL in web layout footer.

---

## Done Criteria

The implementation is acceptance-ready when:

- `pnpm install` works from a clean checkout.
- `pnpm lint` passes without material warnings.
- `pnpm typecheck` passes.
- `pnpm test:run` passes, including integration tests.
- `pnpm build` builds all packages, including `packages/ui`.
- `pnpm dev` starts the web app.
- `pnpm cli scan` scans supported local session folders.
- Zod schemas and example config match the 19-provider registry.
- DB schema version is documented; upgrade path tested from prior `stats.db`.
- Every supported provider appears in CLI and web settings.
- Every parser has fixtures (including Claude, Codex, Gemini per Phase 2.17).
- Every parser handles missing/corrupt files without crashing.
- SQLite sources are opened read-only.
- CLI stats work for day, month, year, and custom ranges.
- CLI `--json` works for every command.
- `agent-usage providers` and `agent-usage providers detect` work.
- `agent-usage inspect-schema` works for OpenCode, Goose, Kilo, and Hermes.
- `dashboard` works from installed/built artifact, not only git checkout.
- Scan history and parser warnings visible in CLI/web.
- Web dashboard shows token and cost charts.
- Web dashboard works when most sources are metadata-only.
- Web dashboard can filter by usage confidence.
- Web Providers page shows detection, support level, warnings, scan status, and exact-vs-metadata-only counts.
- Prompt viewer works with privacy disabled.
- Prompt viewer handles prompt-history-only providers with hidden content.
- Pricing can be edited and imported/exported.
- Pricing aliases cover OpenAI/Codex, Anthropic, Gemini/Google/Vertex/OpenRouter, Qwen, Moonshot/Kimi, and provider-prefixed model names.
- Unknown or missing pricing is clearly marked estimated.
- Prompt/session content never leaves the machine.
- Fresh install stores no prompt content by default.
- Stored prompt/response/raw content can be permanently purged.
- OpenCode handles both legacy JSON and SQLite.
- Copilot doctor explains OpenTelemetry setup.
- Crush is detected but not parsed for usage.
- Aider and Cursor never invent token usage unless estimation is explicitly enabled.
- README explains how to add new providers and lists explicit non-goals.
- `desktop:dev` works or remains absent until Phase 8.2 ships.
