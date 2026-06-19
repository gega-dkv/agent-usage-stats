# Homebrew install (template)

This repository includes a **formula template** for macOS Homebrew. There is no official tap yet — use this as a starting point for a third-party or future official tap.

## Prerequisites

- macOS with [Homebrew](https://brew.sh/)
- Node.js 20+ (the formula depends on `node`)

## Local formula (development)

```bash
# From repository root — build first
pnpm install
pnpm build

# Install via local formula file
brew install --build-from-source ./Formula/agent-usage.rb
```

## Template formula

See [`Formula/agent-usage.rb`](../Formula/agent-usage.rb). Before publishing a tap, update:

- `url` / `sha256` for release tarballs (or use `head` for git installs)
- `version` to match `@agent-usage/cli` in `apps/cli/package.json`
- `test` block once a stable binary path is confirmed

## After install

```bash
agent-usage doctor
agent-usage sync
agent-usage dashboard
```

Data is stored locally at `~/.config/agent-usage-stats/stats.db` (or `$XDG_CONFIG_HOME/agent-usage-stats/stats.db`).

## Creating a tap (optional)

1. Create a GitHub repo named `homebrew-agent-usage` (Homebrew convention: `homebrew-<name>`).
2. Copy `Formula/agent-usage.rb` into the tap.
3. Users install with:

   ```bash
   brew tap your-org/agent-usage
   brew install agent-usage
   ```

## Non-goals

- No auto-update of session data or pricing via Homebrew — the app remains fully local-first.
- Windows/Linux package managers are out of scope for this template; see the main README for path verification notes.
