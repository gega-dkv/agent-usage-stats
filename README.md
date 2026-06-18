# Agent Usage Stats

Local-first AI session usage analyzer for Codex, Claude, and Gemini.

[![MIT License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Session Discovery** - Auto-discover session files from supported AI tools
- **Token Tracking** - Track input, output, cached, and reasoning tokens
- **Cost Estimation** - Calculate API-equivalent costs with configurable pricing
- **Prompt Viewer** - Inspect and search prompts (with privacy controls)
- **Web Dashboard** - Beautiful charts and visualizations
- **CLI Tool** - Command-line interface for power users
- **Local-First** - All data stays on your machine

## Supported Providers

| Provider | Status | Default Path |
|----------|--------|--------------|
| Claude Code | ✅ Supported | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | ✅ Supported | `~/.codex/**` or `$CODEX_HOME` |
| Gemini CLI | ✅ Supported | `~/.gemini/tmp/**/chats/**/*` |

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
# Scan all providers
pnpm cli scan

# Scan specific provider
pnpm cli scan --provider claude

# Show usage stats
pnpm cli stats

# Show daily stats
pnpm cli stats --day

# Search prompts
pnpm cli prompts --search "refactor auth"

# Manage pricing
pnpm cli pricing list
pnpm cli pricing import pricing.json
```

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
│   ├── core/          # Core scan engine
│   ├── db/            # SQLite + Drizzle ORM
│   ├── parsers/       # Provider parsers
│   ├── pricing/       # Pricing engine
│   ├── shared/        # Shared types & utils
│   └── ui/            # Chart components
└── package.json
```

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

1. Create a new parser in `packages/parsers/src/`
2. Implement the `ProviderParser` interface
3. Register the parser in `packages/parsers/src/index.ts`
4. Add discovery paths in `packages/parsers/src/discovery.ts`

```typescript
import type { ProviderParser } from '@agent-usage/shared';

export const myParser: ProviderParser = {
  provider: 'myprovider',
  
  canParse(filePath: string, sample: string): boolean {
    // Return true if this parser handles the file
  },
  
  async parse(filePath: string, options?: ParserOptions): Promise<ParseResult> {
    // Parse the file and return normalized sessions
  },
};
```

## License

MIT
