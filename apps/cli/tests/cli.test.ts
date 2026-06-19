import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { validateConfig, getDefaultConfig } from '@agent-usage/core';
import { parseAppConfig } from '@agent-usage/shared';
import { initializeDatabase } from '@agent-usage/db';
import {
  getWeeklyUsage,
  refreshUsageRollups,
  purgeContent,
} from '@agent-usage/db';
import { findRepoRoot, resolveWebAppTarget, getCliPackageRoot } from '../src/web-app.js';

const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))!;
const cliEntry = path.join(repoRoot, 'apps/cli/dist/index.js');

describe('CLI config contract', () => {
  it('validateConfig returns ok when no config file exists', () => {
    const result = validateConfig();
    expect(result.ok).toBe(true);
  });

  it('getDefaultConfig includes all registered providers', () => {
    const config = getDefaultConfig();
    const parsed = parseAppConfig(config);
    expect(parsed.providers.claude).toBeDefined();
    expect(parsed.providers.codex).toBeDefined();
    expect(parsed.providers.gemini).toBeDefined();
    expect(Object.keys(parsed.providers).length).toBeGreaterThanOrEqual(19);
  });
});

describe('getWeeklyUsage', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `aus-week-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const { sqlite } = initializeDatabase(dbPath);
    const insert = sqlite.prepare(`
      INSERT INTO sessions (
        id, provider, project_name, started_at, updated_at,
        input_tokens, output_tokens, total_tokens, estimated_cost, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Same ISO week (2026-06-16 is a Monday; 2026-06-18 is Wednesday)
    insert.run(
      'w1',
      'claude',
      'proj',
      '2026-06-16T10:00:00Z',
      '2026-06-16T10:00:00Z',
      100,
      50,
      150,
      1.5,
      'claude-sonnet',
      '2026-06-16T10:00:00Z',
    );
    insert.run(
      'w2',
      'claude',
      'proj',
      '2026-06-18T10:00:00Z',
      '2026-06-18T10:00:00Z',
      200,
      100,
      300,
      3.0,
      'claude-sonnet',
      '2026-06-18T10:00:00Z',
    );
    refreshUsageRollups(sqlite);
    sqlite.close();
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it('aggregates daily rollups into ISO weeks', () => {
    const { db, sqlite } = initializeDatabase(dbPath);
    const weeks = getWeeklyUsage(db);
    sqlite.close();

    expect(weeks.length).toBeGreaterThanOrEqual(1);
    const week = weeks.find((w) => w.week === '2026-06-15');
    expect(week).toBeDefined();
    expect(week!.sessions).toBe(2);
    expect(week!.totalTokens).toBe(450);
    expect(week!.estimatedCost).toBeCloseTo(4.5);
  });

  it('respects --from/--to date filters', () => {
    const { db, sqlite } = initializeDatabase(dbPath);
    const weeks = getWeeklyUsage(db, { from: '2026-06-17', to: '2026-06-30' });
    sqlite.close();

    const week = weeks.find((w) => w.week === '2026-06-15');
    expect(week).toBeDefined();
    expect(week!.sessions).toBe(1);
    expect(week!.totalTokens).toBe(300);
  });
});

describe('resolveWebAppTarget', () => {
  it('finds monorepo dev or production target from repo root', () => {
    const target = resolveWebAppTarget();
    expect(target).not.toBeNull();
    if (target?.kind === 'dev') {
      expect(fs.existsSync(path.join(target.webDir, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(target.repoRoot, 'pnpm-workspace.yaml'))).toBe(true);
    } else if (target?.kind === 'production') {
      expect(fs.existsSync(path.join(target.webDir, '.next', 'BUILD_ID'))).toBe(true);
    }
  });

  it('prefers bundled web/ inside the CLI package when present', () => {
    const bundled = path.join(getCliPackageRoot(), 'web');
    if (!fs.existsSync(path.join(bundled, '.next', 'BUILD_ID'))) {
      return; // skipped until `pnpm build` has run
    }
    const target = resolveWebAppTarget();
    expect(target?.kind).toBe('production');
    expect(target && 'webDir' in target && target.webDir).toBe(bundled);
  });
});

describe('CLI subprocess contracts', () => {
  let dbPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `aus-cli-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    env = { ...process.env, AGENT_USAGE_DB_PATH: dbPath };
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  function runCli(args: string[]): string {
    return execFileSync(process.execPath, [cliEntry, ...args], {
      cwd: repoRoot,
      env,
      encoding: 'utf-8',
    });
  }

  it('stats --week --json returns weekly rollups', () => {
    runCli(['seed', '--sessions', '2', '--json']);
    const out = runCli(['stats', '--week', '--json']);
    const parsed = JSON.parse(out) as { granularity: string; data: Array<{ week: string }> };
    expect(parsed.granularity).toBe('week');
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it('stats export writes CSV with metadata json', () => {
    runCli(['seed', '--sessions', '1', '--json']);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aus-export-'));
    const outFile = path.join(outDir, 'usage.csv');
    const meta = runCli([
      'stats',
      'export',
      '--day',
      '--format',
      'csv',
      '-o',
      outFile,
      '--json',
    ]);
    const parsed = JSON.parse(meta) as { exported: number; format: string; path: string };
    expect(parsed.format).toBe('csv');
    expect(parsed.path).toBe(outFile);
    expect(fs.existsSync(outFile)).toBe(true);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('sessions export returns json array with --json', () => {
    runCli(['seed', '--sessions', '1', '--json']);
    const out = runCli(['sessions', 'export', '--json']);
    const sessions = JSON.parse(out) as unknown[];
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it('privacy purge-content reports counts in json', () => {
    runCli(['seed', '--sessions', '1', '--json']);
    const out = runCli(['privacy', 'purge-content', '--json']);
    const parsed = JSON.parse(out) as { purged: { messages: number; fts: number; sessions: number } };
    expect(parsed.purged.messages).toBeGreaterThanOrEqual(0);
    expect(typeof parsed.purged.sessions).toBe('number');
  });
});
