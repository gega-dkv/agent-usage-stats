# Agent Usage Stats — Desktop App

Local-first desktop shell built with [Tauri v2](https://v2.tauri.app/). The app embeds the same Next.js dashboard as the CLI `dashboard` command — **localhost only**, no public network server.

## How it works

1. On launch, the app sets `AGENT_USAGE_DB_PATH` to the OS app data directory (via Tauri’s path API).
2. It spawns `node …/cli/dist/index.js dashboard --port 3847 --no-open` (dev) or the bundled CLI (release builds).
3. A webview loads a splash page, then redirects to `http://127.0.0.1:3847` when the server is ready.

All session reads and SQLite access stay on your machine — same privacy model as the CLI and web app.

## Prerequisites

### macOS (primary)

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Xcode Command Line Tools (if not installed)
xcode-select --install
```

### Linux

- Rust (via rustup)
- WebKitGTK and other [Tauri Linux dependencies](https://v2.tauri.app/start/prerequisites/#linux)

### Windows

- Rust, Visual Studio Build Tools, WebView2 — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows)

### Monorepo build (required before desktop dev)

From the repository root:

```bash
pnpm install
pnpm build   # builds web bundle + CLI used by the desktop shell
```

## Development

```bash
# From repository root
pnpm desktop:dev
```

This runs `tauri dev` in `apps/desktop`. The Rust setup hook starts the CLI dashboard on port **3847** (non-default to avoid clashing with `pnpm dev` on 3000).

Optional: point at a custom CLI build:

```bash
export AGENT_USAGE_CLI=/absolute/path/to/agent-usage-stats/apps/cli/dist/index.js
pnpm desktop:dev
```

## Production build

```bash
pnpm desktop:build
```

Artifacts appear under `apps/desktop/src-tauri/target/release/bundle/` (`.app` on macOS, `.deb`/`.AppImage` on Linux, `.msi` on Windows).

**CI note:** Desktop builds are optional in CI — they require Rust and platform-specific SDKs. The main CI workflow runs lint, typecheck, test, and `pnpm build` only.

## Data directory

| Platform | SQLite path (via `AGENT_USAGE_DB_PATH`) |
|----------|----------------------------------------|
| macOS | `~/Library/Application Support/com.agentusage.stats/stats.db` |
| Linux | `~/.local/share/com.agentusage.stats/stats.db` |
| Windows | `%APPDATA%\com.agentusage.stats\stats.db` |

## Offline operation

The desktop app does not require internet access. Provider session files are read from local paths (macOS defaults first; Windows/Linux paths use the same provider registry and `$ENV`/`~` expansion as the CLI).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `dashboard` fails to start | Run `pnpm build` from repo root so `apps/cli/web` exists |
| Port 3847 in use | Set `AGENT_USAGE_DASHBOARD_PORT` (see `src-tauri/src/lib.rs`) |
| Rust not found | Install rustup and restart your shell |
| Blank webview | Wait a few seconds; check CLI logs with `RUST_LOG=debug pnpm desktop:dev` |
