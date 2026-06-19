import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type WebAppTarget =
  | { kind: 'production'; webDir: string }
  | { kind: 'dev'; repoRoot: string; webDir: string };

/** Directory containing this CLI package (apps/cli when developing). */
export function getCliPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function isWebPackage(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'package.json'));
}

function hasNextBuild(dir: string): boolean {
  return fs.existsSync(path.join(dir, '.next', 'BUILD_ID'));
}

function bundledWebDir(): string | null {
  const bundled = path.join(getCliPackageRoot(), 'web');
  return isWebPackage(bundled) && hasNextBuild(bundled) ? bundled : null;
}

/** Walk up from cwd to find a directory containing pnpm-workspace.yaml. */
export function findRepoRoot(startDir = process.cwd()): string | null {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function collectSearchRoots(): string[] {
  const roots = new Set<string>();
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    roots.add(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  roots.add(path.resolve(cliDir, '../..'));
  roots.add(path.resolve(cliDir, '../../..'));
  return [...roots];
}

/**
 * Resolve how to start the web dashboard:
 * 1. Bundled web/ directory shipped with the CLI package
 * 2. Built Next.js app in node_modules/@agent-usage/web or apps/web
 * 3. Monorepo dev server (pnpm dev) when source checkout exists
 */
export function resolveWebAppTarget(): WebAppTarget | null {
  const bundled = bundledWebDir();
  if (bundled) {
    return { kind: 'production', webDir: bundled };
  }

  for (const root of collectSearchRoots()) {
    const npmWeb = path.join(root, 'node_modules', '@agent-usage', 'web');
    if (isWebPackage(npmWeb) && hasNextBuild(npmWeb)) {
      return { kind: 'production', webDir: npmWeb };
    }

    const appsWeb = path.join(root, 'apps', 'web');
    if (isWebPackage(appsWeb) && hasNextBuild(appsWeb)) {
      return { kind: 'production', webDir: appsWeb };
    }
  }

  const repoRoot = findRepoRoot();
  if (repoRoot) {
    const appsWeb = path.join(repoRoot, 'apps', 'web');
    if (isWebPackage(appsWeb)) {
      return { kind: 'dev', repoRoot, webDir: appsWeb };
    }
  }

  return null;
}
