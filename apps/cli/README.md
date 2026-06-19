# @agent-usage/cli

Local-first AI session usage analyzer — command-line interface.

## Install from monorepo build

```bash
# From repository root
pnpm install
pnpm build
pnpm link --global --filter @agent-usage/cli
```

Then run `agent-usage` from anywhere:

```bash
agent-usage scan
agent-usage dashboard
```

## Global install (npm registry)

When published to npm:

```bash
npm install -g @agent-usage/cli
agent-usage dashboard
```

The `dashboard` command serves the bundled Next.js build from `web/` (populated by `scripts/bundle-web.mjs` during `pnpm build`).

## Package layout

| Path | Purpose |
|------|---------|
| `dist/` | Compiled CLI entry (`agent-usage` bin) |
| `web/` | Bundled Next.js production build (generated at build time) |
| `scripts/bundle-web.mjs` | Copies `apps/web/.next` into `web/` |
