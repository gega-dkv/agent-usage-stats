# Agent Usage Stats

Local-first AI session usage analyzer for Codex, Claude, and Gemini.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Provider Registry** - 19 agents described in one place; detection, CLI, and UI all derived from it
- **Session Discovery** - Auto-discover session files from supported AI tools (`~`/`$ENV` path expansion)
- **Token Tracking** - Track input, output, cached, and reasoning tokens
- **Cost Estimation** - API-equivalent costs with configurable pricing; estimated costs clearly flagged
- **Full-Text Search** - SQLite FTS5 over stored prompts (with a LIKE fallback)
- **Prompt Viewer** - Inspect and search prompts (with privacy controls)
- **Schema Inspection** - Read-only `inspect-schema` for SQLite-backed providers
- **Web Dashboard** - Charts, visualizations, and a per-provider status page
- **CLI Tool** - Command-line interface for power users (`--json` everywhere)
- **Local-First** - All data stays on your machine; content is never sent anywhere

## Supported Providers

Every provider below is described in a single **provider registry**
(`packages/shared/src/providers.ts`) that drives discovery, the CLI, and the web
Providers page. Providers with a parser are fully ingested; the rest are detected
so you can see them in the dashboard while parsers are added.

**Support levels:** `exact-usage` (per-message token counts) ·
`partial-usage` (tokens when present, otherwise estimated) ·
`prompt-history-only` (no token data; never invented) ·
`detected-only` (recognized, parser pending) · `unsupported` (detection only).

| Provider | Support | Storage | Default path / env |
|----------|---------|---------|--------------------|
| Claude Code | ✅ exact-usage | jsonl | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | ✅ partial-usage | json/jsonl | `$CODEX_HOME` or `~/.codex` |
| Gemini CLI | ✅ partial-usage | json | `~/.gemini/tmp/**/chats/**/*` |
| OpenCode | detected-only | sqlite/json | `$OPENCODE_DATA_DIR`, `~/.local/share/opencode` |
| Qwen Code | detected-only | jsonl | `$QWEN_DATA_DIR`, `~/.qwen` |
| Goose | detected-only | sqlite | `$GOOSE_PATH_ROOT`, `~/.local/share/goose` |
| Factory Droid | detected-only | json | `$DROID_SESSIONS_DIR`, `~/.factory` |
| Amp | detected-only | json | `$AMP_DATA_DIR`, `~/.local/share/amp` |
| Codebuff | detected-only | json | `$CODEBUFF_DATA_DIR`, `~/.config/manicode` |
| Kimi CLI | detected-only | jsonl | `$KIMI_DATA_DIR`, `~/.kimi` |
| GitHub Copilot CLI | detected-only | otel | `$COPILOT_OTEL_FILE_EXPORTER_PATH` |
| OpenClaw | detected-only | jsonl | `$OPENCLAW_DIR`, `~/.openclaw` |
| Hermes Agent | detected-only | sqlite | `$HERMES_HOME`, `~/.hermes` |
| pi-agent | detected-only | jsonl/json | `$PI_AGENT_DIR`, `~/.pi/agent` |
| Kilo | detected-only | sqlite | `$KILO_DATA_DIR`, `~/.local/share/kilo` |
| Aider | prompt-history-only | markdown | `.aider.chat.history.md` |
| Cursor CLI | prompt-history-only | sqlite/markdown | `~/.cursor` |
| SpecStory | prompt-history-only | markdown | `**/.specstory/history/**/*.md` |
| Crush | detection only | json | `~/.config/crush/crush.json` |

Run `pnpm cli providers` to see which are detected on your machine.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### Installation

#### From git checkout (development)

```bash
# Clone the repository
git clone https://github.com/gega-dkv/agent-usage-stats.git
cd agent-usage-stats

# Install dependencies
pnpm install

# Build all packages (includes bundling the web dashboard into the CLI)
pnpm build

# Start the web dashboard (development)
pnpm dev
```

#### Global CLI install (from monorepo build)

After `pnpm build`, install the CLI globally:

```bash
pnpm link --global --filter @agent-usage/cli
```

Then use `agent-usage` from any directory:

```bash
agent-usage sync
agent-usage dashboard    # serves bundled web/ on http://127.0.0.1:3000
```

When published to npm:

```bash
npm install -g @agent-usage/cli
agent-usage dashboard
```

See [`apps/cli/README.md`](apps/cli/README.md) and [`docs/HOMEBREW.md`](docs/HOMEBREW.md) for package layout and optional Homebrew template.

#### Desktop app (Tauri)

Requires Rust and platform SDKs — see [`apps/desktop/README.md`](apps/desktop/README.md).

```bash
pnpm build          # required first
pnpm desktop:dev    # local webview + embedded dashboard on 127.0.0.1:3847
pnpm desktop:build  # native bundle (optional; not run in CI)
```

### Platform notes

- **macOS** is the primary development and verification platform. Default provider paths (`~/.claude`, `~/.codex`, `~/.gemini`, etc.) are tested here first.
- **Linux** uses the same `$XDG_CONFIG_HOME` / `~/.config` conventions for the app database (`~/.config/agent-usage-stats/stats.db`). Provider paths honor `$ENV` overrides in the registry (e.g. `$CODEX_HOME`, `$OPENCODE_DATA_DIR`).
- **Windows** path expansion uses `%USERPROFILE%` via Node’s `os.homedir()` and registry `$ENV` placeholders. Full Windows path QA is a milestone — report issues if a provider’s default path does not resolve on your machine.

Run `agent-usage doctor` on any platform to confirm Node, database, and detected providers.

### CLI Usage

```bash
# Detect installed agents and sync their sessions interactively
pnpm cli sync

# Scan all providers (or just one)
pnpm cli scan
pnpm cli scan --provider claude

# List every supported provider + detection status
pnpm cli providers
pnpm cli providers detect --json

# Usage stats (summary, or --day / --week / --month / --year, with --from/--to)
pnpm cli stats
pnpm cli stats --week --from 2026-01-01 --to 2026-06-30
pnpm cli stats --granularity week --json

# Full-text prompt search (requires privacy mode that stores content)
pnpm cli prompts --search "refactor auth"

# Inspect a SQLite-backed provider DB read-only (never modifies it)
pnpm cli inspect-schema --provider opencode --json

# Provider-specific setup help (e.g. Copilot OpenTelemetry)
pnpm cli doctor
pnpm cli doctor --provider copilot

# Launch the local web dashboard
pnpm cli dashboard
pnpm cli dashboard --json

# Watch for file changes (500ms debounce; emits JSON events with --json)
pnpm cli watch --json

# Export usage and sessions
pnpm cli stats export --day --format csv -o usage.csv
pnpm cli sessions export --format json

# Scan history and parser warnings
pnpm cli scan history --json
pnpm cli warnings --json

# Manage pricing
pnpm cli pricing list
pnpm cli pricing import pricing.json

# Privacy
pnpm cli privacy set full
pnpm cli privacy purge-content
```

Every command supports `--json` for scripting.

## Sync and Watch

### `sync`

Detects installed AI agents (via the provider registry), lets you choose which to ingest, and runs a scan for each.

- **Interactive (TTY):** Lists detected agents and prompts for a selection when more than one is installed.
- **Non-TTY / piped stdin:** Auto-selects the first installed agent (or all when using `--agent all`).
- **`--json`:** Skips prompts and animations; returns `{ agents, selectedProviders, filesScanned, ... }`.
- **`--agent` / `--provider`:** Limit to one provider or `all`.
- **`--path`:** Include custom paths in the scan.

```bash
pnpm cli sync
pnpm cli sync --agent claude
pnpm cli sync --json
```

### `watch`

Watches default provider session paths for new or changed files and re-scans automatically.

- **Debounce:** 500 ms after the last file event before scanning; chokidar waits 1 s for writes to finish (`awaitWriteFinish`).
- **Non-TTY:** No spinner or status animation; use `--json` for machine-readable events.
- **`--json`:** Emits JSON lines: `watch_started`, `file_changed`, and `scan_complete` (with scan stats).

```bash
pnpm cli watch
pnpm cli watch --provider claude --json
```

## Explicit Non-Goals

The following are **not** planned for v1: billing API sync, budgets/alerts, cloud/team features, and real invoice reconciliation. See `IMPLEMENTATION_PLAN.md` for the full list.

## Configuration

### Config File

Create `agent-usage.config.json` in your project root:

```json
{
  "privacyMode": "disabled",
  "providers": {
    "claude": {
      "enabled": true,
      "paths": []
    },
    "codex": {
      "enabled": true,
      "paths": []
    },
    "gemini": {
      "enabled": true,
      "paths": []
    }
  },
  "customPaths": [],
  "currency": "USD",
  "storeRawRecords": false
}
```

### Privacy Modes

| Mode | Description |
|------|-------------|
| `disabled` | Store no prompt content (default) |
| `preview` | Store short redacted previews only |
| `full` | Store full prompt/response content |
| `raw` | Store full raw records (debugging) |

## Pricing

Costs are simulated API-equivalent estimates loaded from a local bundled snapshot and your SQLite database — pricing is never fetched from the internet at runtime. Edit rates in the web UI or import/export JSON:

```bash
# Export current pricing
pnpm cli pricing export > pricing.json

# Import custom pricing (array or { "models": [...], "modelAliases": {...} })
pnpm cli pricing import pricing.json
```

Model aliases map session model names (including provider-prefixed names like `anthropic/claude-sonnet-4` or `openrouter/google/gemini-2.5-pro`) to canonical pricing-table entries. Bundled aliases cover OpenAI/Codex, Anthropic, Gemini/Vertex, Qwen, and Moonshot/Kimi variants; override or extend them in `agent-usage.config.json`:

```json
{
  "modelAliases": {
    "my-internal-codename": "gpt-4o"
  }
}
```

When a model has no matching price, costs fall back to the provider default (e.g. `gpt-4o`, `claude-sonnet-4-20250514`) and are marked **estimated**.

**Pricing profiles:** `api-standard` uses on-demand API list prices (default). `subscription-equivalent` is for comparing usage against flat subscription tiers (ChatGPT Plus, Claude Pro, etc.) — clone the profile in the web Pricing page and edit per-token rates to match your plan; these are not API list prices.

## Architecture

```
agent-usage-stats/
├── apps/
│   ├── cli/           # CLI tool (+ bundled web/ after build)
│   ├── desktop/       # Tauri desktop shell (optional)
│   └── web/           # Next.js dashboard
├── packages/
│   ├── core/          # Core scan engine (discover → parse → store → roll up)
│   ├── db/            # SQLite + Drizzle ORM, FTS5 search, lightweight migrations
│   ├── parsers/       # Provider parsers + registry-driven discovery
│   ├── pricing/       # Pricing engine + model table
│   ├── shared/        # Shared types, utils, and the provider registry
│   └── ui/            # Chart components
└── package.json
```

The **scan pipeline** (`packages/core/src/scan.ts`) is the heart of the system:
it discovers session files via the provider registry, picks a parser, normalizes
sessions/messages (gated by privacy mode), computes costs, and refreshes the
`usage_daily`/`usage_monthly`/`usage_yearly` rollups the dashboard reads.

## Privacy & Security

- **Local-First**: All data stays on your machine
- **No Telemetry**: Zero network requests by default
- **Configurable Privacy**: Control what content is stored
- **Secure Storage**: SQLite database in app data directory
- **Content Purging**: Permanently delete stored content

## Development

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Build all packages
pnpm build

# Lint code
pnpm lint

# Format code
pnpm format
```

## Adding New Providers

All provider metadata lives in one place — the **provider registry**
(`packages/shared/src/providers.ts`). Discovery, the CLI `providers`/`doctor`
commands, the web Providers page, and pricing all read from it, so a new provider
shows up everywhere from a single entry.

1. **Register the provider.** Add an entry to `PROVIDER_REGISTRY` in
   `packages/shared/src/providers.ts` and add its id to the `Provider` union in
   `packages/shared/src/types.ts`. Set `hasParser: false` to ship detection first.
2. **Write the parser.** Create `packages/parsers/src/<provider>.ts` implementing
   the `ProviderParser` interface (`canParse` + `parse`), then register it in the
   `parsers` array in `packages/parsers/src/index.ts`. Flip `hasParser: true`.
3. **Add fixtures + tests** under `packages/parsers/tests/`.

```typescript
import type { ProviderParser } from '@agent-usage/shared';

export const myParser: ProviderParser = {
  provider: 'myprovider',
  canParse(filePath: string, sample: string): boolean {
    // Return true if this parser handles the file
    return filePath.endsWith('.jsonl') && sample.includes('"usage"');
  },
  async parse(filePath, options) {
    // Parse the file and return { sessions, warnings }
  },
};
```

Path patterns in the registry use `~` and `$ENV` placeholders, expanded at
runtime by the discovery layer. SQLite-backed providers can be explored with
`pnpm cli inspect-schema --provider <id>` before a parser is written.

## License

MIT
