#!/usr/bin/env node
/**
 * Copy the built Next.js app into apps/cli/web so `agent-usage dashboard`
 * works from an installed CLI artifact (not only a git checkout).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(cliRoot, '../..');
const webSrc = path.join(repoRoot, 'apps', 'web');
const webDest = path.join(cliRoot, 'web');

const nextBuildId = path.join(webSrc, '.next', 'BUILD_ID');
if (!fs.existsSync(nextBuildId)) {
  console.warn(
    'bundle-web: apps/web/.next not found — skipping (run `pnpm --filter @agent-usage/web build` first)',
  );
  process.exit(0);
}

if (fs.existsSync(webDest)) {
  fs.rmSync(webDest, { recursive: true, force: true });
}
fs.mkdirSync(webDest, { recursive: true });

fs.cpSync(path.join(webSrc, '.next'), path.join(webDest, '.next'), { recursive: true });

const publicDir = path.join(webSrc, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(webDest, 'public'), { recursive: true });
}

fs.copyFileSync(path.join(webSrc, 'next.config.mjs'), path.join(webDest, 'next.config.mjs'));

const webPkg = JSON.parse(fs.readFileSync(path.join(webSrc, 'package.json'), 'utf-8'));
const bundledPkg = {
  name: '@agent-usage/web-bundled',
  version: webPkg.version,
  private: true,
  type: 'module',
  scripts: {
    start: 'next start --hostname 127.0.0.1',
  },
  dependencies: {
    next: webPkg.dependencies.next,
    react: webPkg.dependencies.react,
    'react-dom': webPkg.dependencies['react-dom'],
  },
};

fs.writeFileSync(path.join(webDest, 'package.json'), `${JSON.stringify(bundledPkg, null, 2)}\n`);
console.log('bundle-web: packaged web dashboard to apps/cli/web');
