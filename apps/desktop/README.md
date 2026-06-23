# Agent Usage Stats — Desktop App

A local-first, native-feeling desktop shell built with [Tauri v2](https://v2.tauri.app/). Unlike a plain webview wrapper, this app ships a **purpose-built Vite + React SPA** as its frontend and adds native desktop affordances (custom titlebar, menu bar, system tray, auto-scan). The data layer runs in a localhost Node sidecar — **localhost only**, no public network server.

## How it works

```
┌─────────────────────────────────────────────────────────┐
│  Tauri window (frameless, custom titlebar, tray, menus)  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Vite + React SPA  (this package's src renderer)     │ │
│  │  • react-router for /, /sessions, /prompts, …        │ │
│  │  • reuses @agent-usage/ui charts + @agent-usage/shared│ │
│  │  • ports the web app's design system verbatim        │ │
│  └──────────────────────────┬──────────────────────────┘ │
│   fetch http://127.0.0.1:3847/api/*   (invoke get_server_url)│
│  ┌──────────────────────────▼──────────────────────────┐ │
│  │  Rust layer (src-tauri/src)                          │ │
│  │  • sidecar.rs — spawn/health/logs for the CLI server │ │
│  │  • menu.rs   — native menu bar + system tray         │ │
│  │  • lib.rs    — commands + lifecycle                  │ │
│  └──────────────────────────┬──────────────────────────┘ │
└─────────────────────────────┼───────────────────────────┘
                ┌─────────────▼──────────────┐
                │ Node CLI sidecar            │ (unchanged: Next.js
                │ apps/cli/dist + apps/cli/web│  server with all /api/*)
                └────────────────────────────┘
```

1. On launch, Rust sets `AGENT_USAGE_DB_PATH` to the OS app-data dir and spawns `node …/cli/dist/index.js dashboard --port 3847 --host 127.0.0.1 --no-open --json`.
2. The SPA's **boot screen** polls the sidecar (via the `get_server_status` command) and shows startup logs until the health probe passes — no more silent blank pane.
3. Once healthy, Rust emits `app-ready`, the SPA mounts, and an **auto-scan** fires so charts are fresh.

All session reads and SQLite access stay on your machine — same privacy model as the CLI and web app.

## Native features

- **Custom titlebar** — draggable, macOS traffic-light aware (overlay style); Windows/Linux render their own min/max/close controls.
- **Native menu bar** — App / Edit / View (Rescan ⌘R, Toggle Theme, Reload ⌘⇧R) / Window / Help (Preferences ⌘,). Custom items emit events the SPA acts on.
- **System tray** — click to show/hide; right-click menu (Show / Rescan now / Quit).
- **Auto-scan on launch** — one background sync shortly after the sidecar is ready.
- **Boot screen with diagnostics** — surfaces the sidecar status + recent log lines, or a clear "run `pnpm build` first" error.

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

The SPA's data layer is the CLI's dashboard server, so the CLI + its bundled web build must exist first:

```bash
pnpm install
pnpm build   # builds shared → db → parsers → pricing → ui → core → web → cli
```

## Development

```bash
# From repository root
pnpm desktop:dev
```

This runs `tauri dev`, which first runs the Vite dev server (`pnpm --filter @agent-usage/desktop dev:fe`) on port **1420** for HMR, then launches Rust. The Rust setup hook starts the CLI dashboard on port **3847** (non-default to avoid clashing with `pnpm dev` on 3000).

To develop the SPA alone (fast iteration, no Rust rebuild), start the sidecar manually and run Vite in a browser:

```bash
# Terminal 1: start the data sidecar
pnpm cli -- dashboard --port 3847 --no-open

# Terminal 2: run the SPA in a browser against it
pnpm --filter @agent-usage/desktop dev:fe
```

Optional: point at a custom CLI build:

```bash
export AGENT_USAGE_CLI=/absolute/path/to/agent-usage-stats/apps/cli/dist/index.js
pnpm desktop:dev
```

## Production build

```bash
pnpm desktop:build
```

This builds the SPA (`vite build` → `apps/desktop/dist`) then bundles the Tauri app. Artifacts appear under `apps/desktop/src-tauri/target/release/bundle/` (`.app` on macOS, `.deb`/`.AppImage` on Linux, `.msi` on Windows).

> **Note:** release builds still invoke `node <cli>/dist/index.js`, so distributing a self-contained `.app`/`.msi` requires bundling Node and the built CLI/web artifacts — not yet implemented.

**CI note:** Desktop builds are optional in CI — they require Rust and platform-specific SDKs. The main CI workflow runs lint, typecheck, test, and `pnpm build` only.

## Regenerating icons

The icon set in `src-tauri/icons/` is generated from `src-tauri/source-icon.png`:

```bash
pnpm --filter @agent-usage/desktop exec node scripts/make-icon.mjs   # rebuild source PNG (dependency-free)
pnpm --filter @agent-usage/desktop tauri icon src-tauri/source-icon.png  # generate all sizes
```

## Data directory

| Platform | SQLite path (via `AGENT_USAGE_DB_PATH`) |
|----------|----------------------------------------|
| macOS | `~/Library/Application Support/com.agentusage.stats/stats.db` |
| Linux | `~/.local/share/com.agentusage.stats/stats.db` |
| Windows | `%APPDATA%\com.agentusage.stats\stats.db` |

## Architecture details

| Concern | Location |
|---------|----------|
| SPA entry / routing | `src/main.tsx`, `src/App.tsx` |
| Sidecar fetch layer | `src/lib/api.ts` |
| Tauri event bridge | `src/lib/tauri-events.ts` |
| Design tokens + fonts | `src/index.css` (ported from `apps/web`) |
| Shell (sidebar/topbar/titlebar) | `src/components/` |
| Rust sidecar manager | `src-tauri/src/sidecar.rs` |
| Rust menu + tray | `src-tauri/src/menu.rs` |
| Rust commands + lifecycle | `src-tauri/src/lib.rs` |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Boot screen shows "couldn't reach the local data server" | Run `pnpm build` from repo root so `apps/cli/web` exists |
| Port 3847 in use | Set `AGENT_USAGE_DASHBOARD_PORT` (see `src-tauri/src/sidecar.rs`) |
| Rust not found | Install rustup and restart your shell |
| Blank webview | The boot screen surfaces logs; check them, or run `RUST_LOG=debug pnpm desktop:dev` |
| SPA not updating in `tauri dev` | Vite HMR runs on port 1420; save a file to trigger reload |
