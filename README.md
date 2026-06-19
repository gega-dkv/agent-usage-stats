# Agent Usage Stats

Local-first AI session usage analyzer for **19 coding agents** — Claude Code, Codex, Gemini, OpenCode, Copilot CLI, and more.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Provider Registry** — 19 agents in one table; detection, CLI, and UI all derived from it
- **Session Discovery** — Auto-discover session files (`~` / `$ENV` path expansion)
- **Token Tracking** — Input, output, cached, reasoning, and cache-creation tokens where available
- **Cost Estimation** — Simulated API-equivalent costs; estimated rows clearly flagged
- **Full-Text Search** — SQLite FTS5 over stored prompts (LIKE fallback)
- **Prompt Viewer** — Inspect and search prompts with privacy controls
- **Schema Inspection** — Read-only `inspect-schema` for SQLite-backed providers
- **Web Dashboard** — Charts, sessions, pricing editor, provider status
- **CLI Tool** — Full command set with `--json` on every command
- **Desktop App** — Optional Tauri shell (scaffolded; see [Desktop](#desktop-app-tauri))
- **Local-First** — All data stays on your machine; no telemetry by default

## Screenshots

> Placeholder — add dashboard, sessions, and providers page screenshots here before release.

| Dashboard | Sessions | Providers |
|-----------|----------|-----------|
| *(screenshot pending)* | *(screenshot pending)* | *(screenshot pending)* |

## Supported Providers

Every provider is defined in **`packages/shared/src/providers.ts`**. The table below reflects current parser support, default usage confidence, and storage format.

**Support levels:** `exact-usage` · `partial-usage` · `prompt-history-only` · `detected-only`

**Usage confidence** (per session): `exact` · `cumulative-delta` · `provider-recorded-cost` · `estimated-from-text` · `metadata-only` · `unavailable`

| Provider | Parser | Support | Default confidence | Storage | Default path / env |
|----------|--------|---------|-------------------|---------|-------------------|
| Claude Code | ✅ | exact-usage | exact | jsonl | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | ✅ | partial-usage | estimated-from-text | json/jsonl | `$CODEX_HOME`, `~/.codex` |
| Gemini CLI | ✅ | partial-usage | estimated-from-text | json | `~/.gemini/tmp/**/chats/**/*` |
| OpenCode | ✅ | partial-usage | exact | sqlite/json | `$OPENCODE_DATA_DIR`, `~/.local/share/opencode` |
| Qwen Code | ✅ | exact-usage | exact | jsonl | `$QWEN_DATA_DIR`, `~/.qwen` |
| Goose | ✅ | exact-usage | exact | sqlite | `$GOOSE_PATH_ROOT`, `~/.local/share/goose` |
| Factory Droid | ✅ | exact-usage | exact | json | `$DROID_SESSIONS_DIR`, `~/.factory` |
| Amp | ✅ | exact-usage | exact | json | `$AMP_DATA_DIR`, `~/.local/share/amp` |
| Codebuff | ✅ | partial-usage | exact | json | `$CODEBUFF_DATA_DIR`, `~/.config/manicode` |
| Kimi CLI | ✅ | exact-usage | exact | jsonl | `$KIMI_DATA_DIR`, `~/.kimi` |
| GitHub Copilot CLI | ✅ | exact-usage | exact | otel | `$COPILOT_OTEL_FILE_EXPORTER_PATH`, `~/.copilot/otel` |
| OpenClaw | ✅ | partial-usage | provider-recorded-cost | jsonl | `$OPENCLAW_DIR`, `~/.openclaw` |
| Hermes Agent | ✅ | exact-usage | provider-recorded-cost | sqlite | `$HERMES_HOME`, `~/.hermes` |
| pi-agent | ✅ | partial-usage | exact | jsonl/json | `$PI_AGENT_DIR`, `~/.pi/agent` |
| Kilo | ✅ | exact-usage | provider-recorded-cost | sqlite | `$KILO_DATA_DIR`, `~/.local/share/kilo` |
| Aider | ✅ | prompt-history-only | metadata-only | markdown | `**/.aider.chat.history.md` |
| Cursor CLI | ✅ | prompt-history-only | metadata-only | sqlite/markdown | `~/.cursor` |
| SpecStory | ✅ | prompt-history-only | metadata-only | markdown | `**/.specstory/history/**/*.md` |
| Crush | ⚠️ detect only | detected-only | unavailable | json | `~/.config/crush/crush.json` |

Run `agent-usage providers` or `agent-usage providers detect --json` to see which agents are installed on your machine.

### Prompt-history-only providers

**Aider**, **Cursor CLI**, and **SpecStory** store conversation metadata but do not expose structured token usage. By default the app **never invents token counts** for these sources — sessions appear as metadata-only in stats and the dashboard.

To enable optional text-based token estimation (rough, clearly flagged as `estimated-from-text`), set in `agent-usage.config.json`:

```json
{
  "estimatePromptOnlySources": true
}
```

These providers are **disabled by default** in the example config because they often contain prompt text paths; enable them explicitly when you want ingestion.

### GitHub Copilot CLI (OpenTelemetry)

Copilot does not write usage files unless OpenTelemetry export is enabled. Before running sessions:

```bash
export COPILOT_OTEL_ENABLED=true
export COPILOT_OTEL_EXPORTER_TYPE=file
export COPILOT_OTEL_FILE_EXPORTER_PATH=~/.copilot/otel/usage.jsonl
```

Then run `agent-usage doctor --provider copilot` for setup guidance, or `agent-usage scan --provider copilot`.

### Schema inspection (SQLite providers)

Explore provider databases read-only before writing parsers or debugging:

```bash
agent-usage inspect-schema --provider opencode
agent-usage inspect-schema --provider goose --json
agent-usage inspect-schema --provider kilo --file /path/to/kilo.db
agent-usage inspect-schema --provider hermes
```

Supported providers: **OpenCode**, **Goose**, **Kilo**, **Hermes**. The command never modifies source databases.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### Installation

#### From git checkout (development)

```bash
git clone https://github.com/gega-dkv/agent-usage-stats.git
cd agent-usage-stats
pnpm install
pnpm build          # builds packages + bundles web into CLI
pnpm dev            # web dashboard at http://127.0.0.1:3000
```

#### Global CLI (from monorepo build)

```bash
pnpm link --global --filter @agent-usage/cli
# or after npm publish:
npm install -g @agent-usage/cli
```

Then from any directory:

```bash
agent-usage sync
agent-usage dashboard    # bundled web on http://127.0.0.1:3000
```

See [`apps/cli/README.md`](apps/cli/README.md) for package layout.

#### Homebrew (macOS, template)

No official tap yet. A formula template is included for local or third-party taps:

```bash
pnpm build
brew install --build-from-source ./Formula/agent-usage.rb
```

Details: [`docs/HOMEBREW.md`](docs/HOMEBREW.md).

#### Desktop app (Tauri)

Requires Rust and platform SDKs — see [`apps/desktop/README.md`](apps/desktop/README.md).

```bash
pnpm build
pnpm desktop:dev      # webview + dashboard on http://127.0.0.1:3847
pnpm desktop:build    # native bundle (optional; not in default CI)
```

**Roadmap:** Desktop is scaffolded (local webview, OS app-data DB path, offline). Full release bundling (sidecar CLI, icons, store signing) follows `apps/desktop/README.md`.

### Platform notes

- **macOS** — primary development and path verification platform
- **Linux** — app DB at `$XDG_CONFIG_HOME/agent-usage-stats/stats.db`; provider paths honor `$ENV` overrides
- **Windows** — `%USERPROFILE%` expansion; full path QA is a milestone — run `agent-usage doctor` to validate

## CLI Usage

All commands support `--json` for scripting. Replace `pnpm cli` with `agent-usage` when globally installed.

### Scanning and sync

```bash
pnpm cli sync                          # detect agents, interactive or auto select
pnpm cli sync --agent claude --json
pnpm cli sync --agent all --path ~/custom/sessions

pnpm cli scan
pnpm cli scan --provider claude
pnpm cli scan history --json
pnpm cli warnings --json
```

### Stats and export

```bash
pnpm cli stats                         # summary
pnpm cli stats --day
pnpm cli stats --week --from 2026-01-01 --to 2026-06-30
pnpm cli stats --month --year --json
pnpm cli stats --granularity week

pnpm cli stats export --day --format csv -o usage.csv
pnpm cli stats export --month --format json
pnpm cli sessions export --format json -o sessions.json
```

### Prompts and sessions

```bash
pnpm cli prompts                       # list prompts (privacy mode must store content)
pnpm cli prompts --search "refactor auth"
```

### Providers and health

```bash
pnpm cli providers
pnpm cli providers detect --json
pnpm cli doctor
pnpm cli doctor --provider copilot --json
pnpm cli inspect-schema --provider opencode --json
```

### Dashboard, watch, privacy, pricing

```bash
pnpm cli dashboard
pnpm cli dashboard --json              # { url, port, pid }
pnpm cli dashboard --port 3001 --no-open

pnpm cli watch
pnpm cli watch --provider claude --json

pnpm cli privacy status
pnpm cli privacy set full
pnpm cli privacy purge-content

pnpm cli pricing list
pnpm cli pricing import pricing.example.json
pnpm cli pricing export -o my-pricing.json
```

### Development / seed

```bash
pnpm cli seed --json                   # populate demo data (dev)
```

## Sync and Watch

### `sync`

Detects installed agents via the provider registry, lets you choose which to ingest, and scans each.

| Mode | Behavior |
|------|----------|
| Interactive (TTY) | Lists detected agents; prompts when multiple are installed |
| Non-TTY / piped | Auto-selects first installed agent, or all with `--agent all` |
| `--json` | Skips prompts; returns `{ agents, selectedProviders, filesScanned, ... }` |
| `--agent` / `--provider` | Limit to one provider or `all` |
| `--path` | Include custom paths in the scan |

### `watch`

Watches default provider session paths and re-scans on file changes.

- **Debounce:** 500 ms after the last event; chokidar `awaitWriteFinish` waits 1 s for writes to finish
- **Non-TTY:** No spinner; use `--json` for machine-readable events
- **`--json` events:** `watch_started`, `file_changed`, `scan_complete` (includes scan stats)

## Web App Usage

### Development

```bash
pnpm dev    # http://127.0.0.1:3000
```

### From CLI (production build)

```bash
pnpm build
pnpm cli dashboard    # or: agent-usage dashboard
```

Serves the bundled Next.js app from `apps/cli/web`. Binds to **127.0.0.1** only.

### Pages

| Page | Purpose |
|------|---------|
| **Dashboard** | Time range, group-by, metrics, cost-by-model, provider comparison, confidence filter |
| **Sessions** | List, detail timeline, tool calls, parser warnings |
| **Prompts** | Paginated list, filters, privacy toggle; metadata-only messaging for prompt-history providers |
| **Pricing** | Edit rates, profiles (`api-standard`, `subscription-equivalent`), import/export |
| **Providers** | Detection status, support level, warnings, exact vs metadata-only counts |
| **Settings** | Provider toggles/paths, privacy, estimation fallback, rescan, rebuild rollups |

First visit: run **Scan** from Settings or `agent-usage sync` to populate the database.

## Configuration

Copy `agent-usage.config.example.json` to your project root (or home). Key fields:

| Field | Description |
|-------|-------------|
| `privacyMode` | `disabled` (default), `preview`, `full`, or `raw` |
| `estimatePromptOnlySources` | Allow rough token estimation for Aider/Cursor/SpecStory (default: `false`) |
| `resimulateRecordedCosts` | Recompute costs from pricing table even when provider recorded a cost |
| `modelAliases` | Map session model names to pricing table entries |
| `providers` | Per-provider `enabled` and optional `paths` (all 19 providers listed in example) |
| `storeRawRecords` | Persist raw parser records (debugging; default `false`) |

Database location: `config.dbPath` → `AGENT_USAGE_DB_PATH` → `~/.config/agent-usage-stats/stats.db`.

**Schema version:** existing databases upgrade automatically via migrations (`schema_version` **3** in `packages/db`). Run `agent-usage doctor` to see current version.

### Privacy modes

| Mode | Stored content |
|------|----------------|
| `disabled` | Token/cost metadata only; no prompt text (default) |
| `preview` | Short redacted previews |
| `full` | Full prompt/response text |
| `raw` | Full raw records (debugging) |

Changing privacy mode affects **future scans** only unless you rescan. Use `privacy purge-content` to permanently delete stored text.

## Pricing

Costs are **simulated API-equivalent estimates** from a local bundled snapshot and your SQLite pricing table — **never fetched from the internet at runtime**. They are not billed amounts and are not reconciled with provider invoices.

```bash
pnpm cli pricing export > pricing.json
pnpm cli pricing import pricing.example.json
```

Import accepts an array of models or `{ "models": [...], "modelAliases": {...} }` (see `pricing.example.json`).

**Model aliases** resolve names like `anthropic/claude-sonnet-4` or `openrouter/google/gemini-2.5-pro` to canonical pricing rows. Bundled aliases cover OpenAI/Codex, Anthropic, Gemini/Vertex/OpenRouter, Qwen, and Moonshot/Kimi. Override in config:

```json
{
  "modelAliases": {
    "my-internal-codename": "gpt-4o",
    "team-claude-alias": {
      "target": "claude-sonnet-4-20250514",
      "provider": "anthropic"
    }
  }
}
```

Unknown models fall back to the provider default with **`cost_estimated: true`**.

**Profiles:** `api-standard` (on-demand list prices, default) vs `subscription-equivalent` (compare against flat tiers like ChatGPT Plus — edit per-token rates in the web UI).

## Privacy & Security

- **Local-first** — Session files and SQLite DB never leave your machine
- **No telemetry** — Zero network requests by default (dashboard binds localhost)
- **Read-only provider DBs** — SQLite sources opened read-only; `inspect-schema` never writes
- **Configurable retention** — Privacy modes control prompt/response/raw storage
- **Purging** — `privacy purge-content` removes message content, FTS index entries, and related metadata
- **Estimation transparency** — Estimated tokens/costs flagged in CLI JSON, web sessions, and stats summary
- **Default safe** — Fresh install stores no prompt content (`privacyMode: disabled`)

## Explicit Non-Goals

The following are **out of scope for v1** (see [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md#non-goals-out-of-scope)):

- **Billing API sync** — no OpenAI/Anthropic/Google invoice or usage API integration
- **Budgets and alerts** — no spend thresholds or notifications
- **Cloud sync / team features** — no multi-user or remote aggregation
- **Real invoice reconciliation** — recorded costs are best-effort from session logs

**Provider evaluation backlog** (not in registry): Windsurf, Cline, Continue, Roo Code, Amazon Q Developer, Zed AI.

## Architecture

```
agent-usage-stats/
├── apps/
│   ├── cli/           # CLI + bundled web/ after build
│   ├── desktop/       # Tauri shell (optional)
│   └── web/           # Next.js dashboard
├── packages/
│   ├── core/          # Scan engine
│   ├── db/            # SQLite, FTS5, migrations (schema_version 3)
│   ├── parsers/       # 19 provider parsers
│   ├── pricing/       # Cost engine + aliases
│   ├── shared/        # Types, schemas, provider registry
│   └── ui/            # Chart components
└── Formula/           # Homebrew template
```

Scan pipeline: discover → parse (privacy-gated) → upsert SQLite → compute costs → refresh rollups.

## Development

```bash
pnpm install
pnpm test:run
pnpm typecheck
pnpm build
pnpm lint
pnpm format
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for parser fixtures, schema changes, and PR guidelines.

## Adding New Providers

1. **Register** in `packages/shared/src/providers.ts` and `Provider` union in `types.ts`
2. **Implement parser** in `packages/parsers/src/<provider>.ts`; register in `packages/parsers/src/index.ts`
3. **Add fixtures + tests** under `packages/parsers/tests/fixtures/<provider>/`
4. **Update** `agent-usage.config.example.json`

```typescript
import type { ProviderParser } from '@agent-usage/shared';

export const myParser: ProviderParser = {
  provider: 'myprovider',
  canParse(filePath: string, sample: string): boolean {
    return filePath.endsWith('.jsonl') && sample.includes('"usage"');
  },
  async parse(filePath, options) {
    return { sessions: [], warnings: [] };
  },
};
```

Use `agent-usage inspect-schema --provider <id>` for SQLite-backed agents before writing parsers.

## License

MIT
