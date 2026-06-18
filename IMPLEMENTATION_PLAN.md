# Implementation Plan

This project is currently a usable prototype, not acceptance-ready. The main gaps are validation failures, missing desktop packaging, incomplete CLI/web contract coverage, and several data integrity/privacy details that need to be made explicit.

## Phase 0: Make The Repo Honest

1. Fix `pnpm typecheck`.
   - Remove unused `React` imports from `packages/ui/src/charts/*`.
   - Add `@agent-usage/ui` to the root `typecheck` and `build` scripts so package failures cannot be hidden.

2. Add CI.
   - Create GitHub Actions workflow for `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test:run`, and `pnpm build`.
   - Cache pnpm store.

3. Fix web runtime warnings.
   - Resolve the React `<title>` warning observed in the Next.js dev server.

## Phase 1: Data Correctness

1. Expand normalized provider types.
   - Add `ProviderId` for existing and new providers: `claude`, `codex`, `gemini`, `opencode`, `qwen`, `goose`, `droid`, `amp`, `codebuff`, `kimi`, `copilot`, `openclaw`, `hermes`, `pi-agent`, `kilo`, `aider`, `cursor`, `specstory`, and `crush`.
   - Add `ProviderSupportLevel`: `exact-usage`, `partial-usage`, `prompt-history-only`, `detected-only`, `unsupported`.
   - Add `UsageConfidence`: `exact`, `cumulative-delta`, `provider-recorded-cost`, `estimated-from-text`, `metadata-only`, `unavailable`.
   - Add expanded token fields: `cacheCreationTokens`, `cacheReadTokens`, `toolTokens`.
   - Add `CostTotals` with recorded cost, simulated cost, pricing source, currency, and estimated flag.
   - Add `sourcePath`, `storageKind`, `supportLevel`, `usageConfidence`, `messageCount`, `promptCount`, `warnings`, and `rawRetention` to normalized sessions.
   - Add `contentHidden`, provider id, usage confidence, total tokens, recorded cost, simulated cost, and metadata to normalized messages.

2. Replace the parser interface.
   - Support parser-owned discovery via `discover(context)`.
   - Change `canParse` to accept a discovered source instead of raw path/sample.
   - Change `parse` to accept `ParseOptions`.
   - Add `DiscoveredSource` with provider, path, storage kind, priority, and metadata.
   - Add `ParseOptions` with privacy mode, timezone, and `allowExperimentalParsers`.

3. Expand parser warning model.
   - Add typed parser warning codes: `missing-file`, `unknown-schema`, `missing-token-fields`, `missing-model`, `missing-timestamp`, `sqlite-table-missing`, `json-parse-error`, `cost-unavailable`, `prompt-storage-disabled`, and `detected-only`.
   - Persist warnings per source and expose them in CLI and web.

4. Fix deduplication.
   - Add a unique index for `provider + sessionId + fileHash`.
   - Hash the full file content or a streaming hash, not only the first sample.
   - Keep duplicate sessions ignored, not fatal.

5. Add durable estimation flags.
   - Add token estimation metadata to normalized messages/sessions.
   - Persist whether usage was explicit, estimated, or partially estimated.
   - Surface estimated status in CLI and web.

6. Preserve pricing fallback status.
   - Persist whether pricing used an exact model match or provider fallback.
   - Mark simulated costs as estimated when pricing is incomplete or fallback-based.
   - Preserve provider-recorded USD cost separately from simulated cost.
   - Add a user setting to resimulate recorded costs instead of using provider-recorded costs.

7. Implement SQLite full-text search.
   - Add FTS table/index for stored prompt/content previews.
   - Keep FTS empty or metadata-safe when privacy mode is `disabled`.
   - Replace prompt `LIKE` search with FTS where content is available.

8. Stream large files.
   - Replace whole-file parser reads with line-by-line or streaming parsing where possible.
   - Keep corrupt record handling warning-based.

## Phase 2: Provider Expansion

1. Add provider registry.
   - Centralize provider metadata: id, display name, default paths, env overrides, storage kinds, support level, and parser availability.
   - Ensure all providers appear in CLI, web settings, provider detection, scan filters, and doctor output.

2. OpenCode parser.
   - Discover `OPENCODE_DATA_DIR`, `~/.local/share/opencode`, `opencode.db`, `opencode-*.db`, legacy `storage/session/**/*.json`, legacy `storage/message/**/*.json`, project-scoped storage, and global storage.
   - Support SQLite read-only parsing.
   - Inspect schema before querying `session`, `message`, `part`, and optional `project`.
   - Parse JSON payloads from `message.data` and `part.data`.
   - Extract role, model, provider, tokens, content parts, tool parts, and cost when present.
   - Treat `cost: 0` as not necessarily free; prefer simulated pricing from token counts.
   - Support legacy JSON session/message joins.
   - Mark usage unavailable when token fields are absent.

3. Qwen Code parser.
   - Discover `QWEN_DATA_DIR`, `~/.qwen`, and `~/.qwen/projects/{project}/chats/*.jsonl`.
   - Stream JSONL line-by-line.
   - Map `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`, and `totalTokenCount`.
   - Set cache creation tokens to zero when unavailable.
   - Price reasoning tokens as output-side usage unless pricing config provides a reasoning rate.
   - Extract prompt text only when privacy mode allows it.

4. Goose parser.
   - Discover `GOOSE_PATH_ROOT`, `~/.local/share/goose/sessions/sessions.db`, `~/Library/Application Support/goose/sessions/sessions.db`, and `~/.local/share/Block/goose/sessions/sessions.db`.
   - Open SQLite read-only and inspect tables/columns.
   - Parse accumulated or direct input/output/total token columns.
   - Parse `model_config_json.model_name`.
   - Infer provider from `provider_name` or model string.
   - If total tokens exceed input plus output, record the remainder as reasoning/tool tokens with exact confidence.
   - Simulate costs from configured pricing.

5. Factory Droid parser.
   - Discover `DROID_SESSIONS_DIR` and `~/.factory/sessions/**/*.settings.json`.
   - Extract session identity, project/session name, model/provider, input/output, cache creation, cache read, and thinking/reasoning tokens.
   - Mark `exact-usage` only when token fields are present.
   - Price reasoning tokens as output-side usage unless a reasoning rate is configured.

6. Amp parser.
   - Discover `AMP_DATA_DIR` and `~/.local/share/amp/threads/**/*.json`.
   - Parse thread/session metadata.
   - Extract usage ledger input/output tokens.
   - Extract assistant cache creation/read tokens when present.
   - Store credits in metadata but keep USD cost simulated unless a real USD cost is recorded.
   - Normalize provider-prefixed model names through pricing aliases.

7. Codebuff parser.
   - Discover `CODEBUFF_DATA_DIR`, `~/.config/manicode`, `~/.config/manicode-dev`, and `~/.config/manicode-staging`.
   - Parse `projects/<project>/chats/<chat-id>/chat-messages.json`.
   - Extract project and chat/session id from path.
   - Search usage in `metadata.usage`, `metadata.codebuff.usage`, and nested run-state provider usage.
   - Support input, output, cache creation, cache read, and credits when available.
   - Preserve metadata and mark usage unavailable when usage metadata is absent.

8. Kimi CLI parser.
   - Discover `KIMI_DATA_DIR` and `~/.kimi/sessions/<group-id>/<session-id>/wire.jsonl`.
   - Stream JSONL line-by-line.
   - Include only `StatusUpdate` messages with non-zero token usage.
   - Map `token_usage.input_other`, `output`, `input_cache_read`, and `input_cache_creation`.
   - Default model display to `kimi-for-coding` unless logs provide a model.
   - Support date-based pricing aliases through config, not hardcoded rules.

9. GitHub Copilot CLI OpenTelemetry parser.
   - Discover `COPILOT_OTEL_FILE_EXPORTER_PATH` and `~/.copilot/otel/*.jsonl`.
   - Parse OpenTelemetry JSONL.
   - Prefer chat spans, then inference logs, then agent-turn logs.
   - Extract model, input/output, cache read/write, reasoning output, session id, and trace id.
   - Add `doctor --provider copilot` output explaining `COPILOT_OTEL_ENABLED=true`, `COPILOT_OTEL_EXPORTER_TYPE=file`, and `COPILOT_OTEL_FILE_EXPORTER_PATH`.
   - Warn when export was not enabled for previous sessions.

10. OpenClaw parser.
    - Discover `OPENCLAW_DIR`, `~/.openclaw`, `~/.clawdbot`, `~/.moltbot`, and `~/.moldbot`.
    - Stream `agents/<agentId>/sessions/<uuid>.jsonl`, deleted logs, and reset logs.
    - Strip `.deleted.<timestamp>` and `.reset.<timestamp>` from session ids.
    - Track model/provider state from `model_change`, `custom`, and `model-snapshot`.
    - Use embedded `cost.total` as recorded cost unless resimulation is enabled.

11. Hermes Agent parser.
    - Discover `HERMES_HOME` and `~/.hermes/state.db`.
    - Support comma-separated Hermes roots.
    - Open SQLite read-only and inspect schema.
    - Read input/output, cache read/write, reasoning tokens, actual cost, estimated cost, and message count.
    - Prefer actual recorded cost, then estimated recorded cost, then simulated cost.

12. pi-agent parser.
    - Discover `PI_AGENT_DIR` and `~/.pi/agent/sessions`.
    - Recursively scan JSONL/JSON session usage files.
    - Extract session identity from directories, file names, or JSON fields.
    - Extract input/output, cache creation/read, model, and timestamps.
    - Preserve metadata and mark usage unavailable when prompt text exists without usage fields.

13. Kilo parser.
    - Discover `KILO_DATA_DIR` and `~/.local/share/kilo/kilo.db`.
    - Open SQLite read-only and inspect schema.
    - Find message/session rows with model, tokens, cache, and cost fields.
    - Use recorded cost when present; otherwise simulate configured cost.
    - Report `sqlite-table-missing` or `unknown-schema` instead of crashing.

14. Aider parser.
    - Support `prompt-history-only` by default.
    - Discover `.aider.chat.history.md`, `.aider.input.history`, `.aider.llm.history`, `AIDER_CHAT_HISTORY_FILE`, `AIDER_INPUT_HISTORY_FILE`, and `AIDER_LLM_HISTORY_FILE`.
    - Parse prompts only when privacy mode allows content.
    - Parse token/cost text markers only when present.
    - Never invent token usage unless `estimatePromptOnlySources` is enabled.
    - Mark fallback text estimates as `estimated-from-text`.

15. Cursor CLI and SpecStory parser.
    - Discover Cursor CLI paths, Cursor desktop `state.vscdb`, and `<project>/.specstory/history/**/*.md`.
    - Inspect Cursor files/SQLite databases before parsing.
    - Extract sessions, prompts, assistant messages, and tool calls when present.
    - Only parse usage/cost when explicit token fields exist.
    - Parse SpecStory markdown title/date from filename, frontmatter, or headings.
    - Treat SpecStory as prompt-history-only unless structured token metadata exists.

16. Crush detection.
    - Discover `.crush.json`, `crush.json`, `~/.config/crush/crush.json`, platform app-data config, and `./.crush/logs/crush.log`.
    - Implement detection and doctor output only.
    - Show detected config/log paths and “No stable public token/session schema configured.”
    - Do not parse token usage until real fixtures confirm schema.

17. Provider fixtures.
    - Create fixture folders under `packages/parsers/fixtures/` for every new provider.
    - Each provider must include minimal valid sample, missing-fields sample, corrupt-file sample, and README with expected normalized output.
    - OpenCode must include both `legacy-json` and `sqlite` fixtures.
    - Copilot fixtures must cover OpenTelemetry JSONL.
    - Crush fixtures must cover detection only.

## Phase 3: CLI Contract Completion

1. Add `--json` support to every command.
   - Cover `pricing import`, `pricing export`, `privacy`, `watch`, `dashboard`, `doctor`, and `seed`.

2. Complete stats behavior.
   - Implement true daily, monthly, and yearly queries.
   - Support `--from` and `--to` consistently.
   - Include totals, most expensive model, most expensive day, and top projects by cost.

3. Improve `dashboard`.
   - Start or open the local web app instead of only printing instructions.
   - Keep behavior local-only.

4. Harden privacy commands.
   - Ensure `privacy purge-content` clears full text, previews, tool previews, and raw records.
   - Report how many rows were purged.

5. Document `sync`.
   - Add README coverage for installed-agent detection and provider selection.
   - Ensure sync animation behaves cleanly in non-TTY and JSON modes.

6. Add provider commands.
   - `agent-usage providers`
   - `agent-usage providers detect`
   - `agent-usage scan --provider <provider>` for every provider id.
   - `agent-usage doctor --provider copilot`
   - `agent-usage doctor --provider opencode`

7. Add schema inspection.
   - Implement `agent-usage inspect-schema --provider opencode`.
   - Implement `agent-usage inspect-schema --provider goose`.
   - Implement `agent-usage inspect-schema --provider kilo`.
   - Implement `agent-usage inspect-schema --provider hermes`.
   - Open source SQLite DBs read-only.
   - List tables and columns.
   - Detect likely session/message/usage tables.
   - Output JSON with guessed mappings.
   - Never modify source DBs.

## Phase 4: Web App Completion

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
   - Add session detail route.
   - Show conversation timeline.
   - Show tool calls separately.
   - Show parser warnings.
   - Add sorting by provider and model.

4. Pricing page.
   - Add custom model creation.
   - Add profile selector.
   - Add clone pricing profile.
   - Add editable cached input and reasoning prices.
   - Show last updated date.

5. Settings page.
   - Add provider paths.
   - Add enable/disable provider toggles.
   - Add raw retention setting.
   - Add token estimation fallback setting.
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

## Phase 5: Pricing And Aliases

1. Keep bundled pricing snapshot local.
   - Do not fetch pricing at runtime unless the user explicitly enables it.
   - Keep bundled pricing JSON user-editable.

2. Add model aliases.
   - OpenAI/Codex aliases.
   - Anthropic aliases.
   - Gemini, Google, Vertex, and OpenRouter Gemini aliases.
   - Qwen aliases.
   - Moonshot/Kimi aliases.
   - Provider-prefixed aliases such as `anthropic/claude...`, `openrouter/...`, and `google/...`.

3. Support provider-specific pricing behavior.
   - Reasoning tokens default to output-side pricing unless a custom reasoning rate exists.
   - Recorded provider cost remains separate from simulated cost.
   - Unknown pricing falls back to provider fallback model and marks cost estimated.

## Phase 6: Privacy Completion

1. Enforce privacy defaults across all new providers.
   - Store token/cost metadata by default.
   - Do not store prompt text by default.
   - Do not store assistant text by default.
   - Do not store raw records by default.
   - Only keep prompt content in memory during parsing when required for enabled estimation.
   - Respect purge command for every parser and storage path.

2. Add prompt-only estimation setting.
   - Add `estimatePromptOnlySources`.
   - Keep it disabled by default.
   - Use it only for sources such as Aider, Cursor, and SpecStory when no structured usage exists.

## Phase 7: shadcn/ui And UI Package

1. Initialize shadcn/ui properly.
   - Add `components.json`.
   - Add required shadcn dependencies and base components.
   - Use shadcn primitives where appropriate.

2. Consolidate chart usage.
   - Use `packages/ui` chart primitives from the web app instead of duplicate local chart implementations.
   - Verify all charts support dark mode, responsive sizing, empty states, keyboard focus, tooltips, compact numbers, and currency formatting.

3. Complete required chart primitives.
   - `UsageLineChart`
   - `UsageBarChart`
   - `CostStackedBarChart`
   - `ProviderDonutChart`
   - `CalendarHeatmap`
   - `ModelCostRanking`

## Phase 8: Desktop Packaging

1. Add Tauri app.
   - Create `apps/desktop`.
   - Wire `pnpm desktop:dev`.
   - Wire `pnpm desktop:build`.
   - Use OS app data directory for SQLite and settings.
   - Do not expose a public network server.

2. Keep desktop local-first.
   - Verify offline operation.
   - Verify local reads for Codex, Claude, and Gemini session files on macOS first.
   - Leave Windows/Linux path support behind provider-path abstraction.

## Phase 9: Tests

1. Add integration test for scan -> DB -> dashboard query.
2. Add CLI JSON contract tests for all commands.
3. Add privacy mode tests.
   - Fresh install stores no prompt content.
   - Preview/full/raw only affect future scans unless rescanned.
   - Purge removes stored prompt/response/raw content.
4. Add parser robustness tests.
   - Corrupt files.
   - Unknown records.
   - Missing usage fields.
   - Duplicate sessions.
   - Large JSONL files.
5. Add provider parser tests.
   - Every new provider has fixture-backed tests.
   - Every parser handles missing/corrupt files without crashing.
   - SQLite provider tests assert source DBs are opened read-only.
   - OpenCode tests cover SQLite and legacy JSON.
   - Copilot tests cover OpenTelemetry enabled and missing-export states.
   - Crush tests cover detected-only behavior.
   - Aider, Cursor, and SpecStory tests assert token usage is not invented unless estimation is explicitly enabled.

## Phase 10: Documentation

1. Complete README.
   - Install instructions.
   - Full CLI examples.
   - `sync` command behavior.
   - Web app usage.
   - Desktop roadmap and commands.
   - Screenshots placeholder section.
   - Security and privacy model.
   - How to add a new provider.

2. Update examples.
   - Verify `pricing.example.json`.
   - Verify `agent-usage.config.example.json`.
   - Add notes about simulated API-equivalent costs.
   - Add provider matrix with support level and usage confidence notes.
   - Document Copilot OpenTelemetry setup.
   - Document schema inspection commands.
   - Document prompt-history-only providers and estimation behavior.

## Done Criteria

The implementation is acceptance-ready when:

- `pnpm install` works from a clean checkout.
- `pnpm lint` passes without material warnings.
- `pnpm typecheck` passes.
- `pnpm test:run` passes, including integration tests.
- `pnpm build` builds all packages, including `packages/ui`.
- `pnpm dev` starts the web app.
- `pnpm cli scan` scans supported local session folders.
- Every supported provider appears in CLI and web settings.
- Every parser has fixtures.
- Every parser handles missing/corrupt files without crashing.
- SQLite sources are opened read-only.
- CLI stats work for day, month, year, and custom ranges.
- CLI `--json` works for every command.
- `agent-usage providers` and `agent-usage providers detect` work.
- `agent-usage inspect-schema` works for OpenCode, Goose, Kilo, and Hermes.
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
- README explains how to add new providers.
