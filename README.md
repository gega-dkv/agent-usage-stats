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

```bash
# Clone the repository
git clone https://github.com/yourusername/agent-usage-stats.git
cd agent-usage-stats

# Install dependencies
pnpm install

# Start the web dashboard
pnpm dev
```

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

# Usage stats (summary, or --day / --month / --year, with --from/--to)
pnpm cli stats
pnpm cli stats --day --from 2026-01-01 --to 2026-06-30

# Full-text prompt search (requires privacy mode that stores content)
pnpm cli prompts --search "refactor auth"

# Inspect a SQLite-backed provider DB read-only (never modifies it)
pnpm cli inspect-schema --provider opencode --json

# Provider-specific setup help (e.g. Copilot OpenTelemetry)
pnpm cli doctor
pnpm cli doctor --provider copilot

# Launch the local web dashboard
pnpm cli dashboard

# Manage pricing
pnpm cli pricing list
pnpm cli pricing import pricing.json

# Privacy
pnpm cli privacy set full
pnpm cli privacy purge-content
```

Every command supports `--json` for scripting.

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

Costs are simulated API-equivalent estimates. Edit pricing in the web UI or import/export JSON:

```bash
# Export current pricing
pnpm cli pricing export > pricing.json

# Import custom pricing
pnpm cli pricing import pricing.json
```

## Architecture

```
agent-usage-stats/
├── apps/
│   ├── cli/           # CLI tool
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
