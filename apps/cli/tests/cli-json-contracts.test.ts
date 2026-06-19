import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { findRepoRoot } from '../src/web-app.js';

const repoRoot = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)))!;
const cliEntry = path.join(repoRoot, 'apps/cli/dist/index.js');
const claudeFixture = path.join(
  repoRoot,
  'packages/parsers/tests/fixtures/claude/valid.jsonl',
);
const opencodeSqliteFixture = path.join(
  repoRoot,
  'packages/parsers/tests/fixtures/opencode/sqlite/valid.db',
);
const pricingFixture = path.join(repoRoot, 'pricing.example.json');

describe('CLI --json output contracts', () => {
  let dbPath: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `aus-cli-json-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
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

  function parseJson<T = unknown>(out: string): T {
    return JSON.parse(out.trim()) as T;
  }

  it('scan --json returns scan result shape', () => {
    const result = parseJson<{
      filesScanned: number;
      sessionsFound: number;
      messagesFound: number;
      warnings: unknown[];
      errors: unknown[];
    }>(runCli(['scan', '--path', claudeFixture, '--provider', 'claude', '--json']));
    expect(result.filesScanned).toBe(1);
    expect(result.sessionsFound).toBeGreaterThan(0);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('scan history --json returns runs array', () => {
    runCli(['scan', '--path', claudeFixture, '--provider', 'claude', '--json']);
    const payload = parseJson<{ runs: Array<{ id: number; status: string }> }>(
      runCli(['scan', 'history', '--json']),
    );
    expect(Array.isArray(payload.runs)).toBe(true);
    expect(payload.runs.length).toBeGreaterThan(0);
    expect(payload.runs[0]).toMatchObject({ id: expect.any(Number), status: expect.any(String) });
  });

  it('sync --json returns aggregate scan stats', () => {
    const result = parseJson<{
      selectedProviders: string[];
      filesScanned: number;
      sessionsFound: number;
      messagesFound: number;
    }>(
      runCli([
        'sync',
        '--provider',
        'claude',
        '--path',
        claudeFixture,
        '--json',
      ]),
    );
    expect(result.selectedProviders).toContain('claude');
    expect(result.sessionsFound).toBeGreaterThan(0);
  });

  it('stats --json returns summary object', () => {
    runCli(['seed', '--sessions', '2', '--json']);
    const summary = parseJson<{ totalSessions: number; totalTokens: number }>(
      runCli(['stats', '--json']),
    );
    expect(summary.totalSessions).toBeGreaterThanOrEqual(2);
    expect(typeof summary.totalTokens).toBe('number');
  });

  it('stats --day --json returns granularity and data array', () => {
    runCli(['seed', '--sessions', '1', '--json']);
    const payload = parseJson<{ granularity: string; data: unknown[] }>(
      runCli(['stats', '--day', '--json']),
    );
    expect(payload.granularity).toBe('day');
    expect(Array.isArray(payload.data)).toBe(true);
  });

  it('prompts --search --json returns result array', () => {
    runCli(['privacy', 'set', 'full', '--json']);
    runCli(['scan', '--path', claudeFixture, '--provider', 'claude', '--json']);
    const out = runCli(['prompts', '--search', 'hello', '--json']);
    const results = parseJson<Array<{ contentPreview: string; provider: string }>>(out);
    expect(Array.isArray(results)).toBe(true);
  });

  it('pricing list/import/export --json return expected shapes', () => {
    const models = parseJson<Array<{ provider: string; model: string }>>(
      runCli(['pricing', 'list', '--json']),
    );
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    const imported = parseJson<{ ok: boolean; imported: number; file: string }>(
      runCli(['pricing', 'import', pricingFixture, '--json']),
    );
    expect(imported.ok).toBe(true);
    expect(imported.imported).toBeGreaterThan(0);

    const exported = parseJson<Array<{ model: string }>>(runCli(['pricing', 'export', '--json']));
    expect(Array.isArray(exported)).toBe(true);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aus-pricing-export-'));
    const outFile = path.join(outDir, 'pricing.json');
    const meta = parseJson<{ exported: number; path: string }>(
      runCli(['pricing', 'export', '-o', outFile, '--json']),
    );
    expect(meta.exported).toBeGreaterThan(0);
    expect(meta.path).toBe(outFile);
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('privacy status/set/purge-content --json return expected shapes', () => {
    const status = parseJson<{ privacyMode: string; storeRawRecords: boolean }>(
      runCli(['privacy', 'status', '--json']),
    );
    expect(['disabled', 'preview', 'full', 'raw']).toContain(status.privacyMode);

    const setResult = parseJson<{ ok: boolean; privacyMode: string }>(
      runCli(['privacy', 'set', 'preview', '--json']),
    );
    expect(setResult.ok).toBe(true);
    expect(setResult.privacyMode).toBe('preview');

    runCli(['seed', '--sessions', '1', '--json']);
    const purged = parseJson<{ purged: { messages: number; fts: number; sessions: number } }>(
      runCli(['privacy', 'purge-content', '--json']),
    );
    expect(typeof purged.purged.messages).toBe('number');
  });

  it('providers and detect --json return agent arrays', () => {
    const agents = parseJson<Array<{ provider: string; label: string }>>(
      runCli(['providers', '--json']),
    );
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThanOrEqual(19);

    const detect = parseJson<{ installed: unknown[] }>(runCli(['providers', 'detect', '--json']));
    expect(Array.isArray(detect.installed)).toBe(true);
  });

  it('inspect-schema --json returns table metadata', () => {
    if (!fs.existsSync(opencodeSqliteFixture)) return;
    const schema = parseJson<{
      provider: string;
      file: string;
      tables: Array<{ table: string; columns: unknown[] }>;
    }>(
      runCli([
        'inspect-schema',
        '--provider',
        'opencode',
        '--file',
        opencodeSqliteFixture,
        '--json',
      ]),
    );
    expect(schema.provider).toBe('opencode');
    expect(schema.file).toBe(opencodeSqliteFixture);
    expect(schema.tables.length).toBeGreaterThan(0);
  });

  it('doctor --json returns health report', () => {
    const report = parseJson<{
      node: { version: string; ok: boolean };
      database: { ok: boolean; schemaVersion: number | null };
      providers: unknown[];
    }>(runCli(['doctor', '--json']));
    expect(report.node.ok).toBe(true);
    expect(report.database.ok).toBe(true);
    expect(Array.isArray(report.providers)).toBe(true);

    const copilot = parseJson<{ provider: string; guidance: string[] }>(
      runCli(['doctor', '--provider', 'copilot', '--json']),
    );
    expect(copilot.provider).toBe('copilot');
    expect(copilot.guidance.some((line) => line.includes('OpenTelemetry'))).toBe(true);
  });

  it('seed --json returns ok and sessionsGenerated', () => {
    const result = parseJson<{ ok: boolean; sessionsGenerated: number }>(
      runCli(['seed', '--sessions', '3', '--json']),
    );
    expect(result.ok).toBe(true);
    expect(result.sessionsGenerated).toBe(3);
  });

  it('warnings --json returns warnings array', () => {
    runCli(['scan', '--path', claudeFixture, '--provider', 'claude', '--json']);
    const payload = parseJson<{ warnings: unknown[] }>(runCli(['warnings', '--json']));
    expect(Array.isArray(payload.warnings)).toBe(true);
  });

  it('watch --json emits watch_started event (mocked short run)', async () => {
    const child = spawn(process.execPath, [cliEntry, 'watch', '--json'], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const firstLine = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch timeout')), 5000);
      let buffer = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const line = buffer.split('\n').find((l) => l.trim());
        if (line) {
          clearTimeout(timeout);
          resolve(line);
        }
      });
      child.on('error', reject);
    });

    child.kill('SIGTERM');
    const event = parseJson<{ event: string }>(firstLine);
    expect(event.event).toBe('watch_started');
  });

  it('dashboard --json returns server metadata', async () => {
    const child = spawn(
      process.execPath,
      [cliEntry, 'dashboard', '--json', '--port', '3999', '--no-open'],
      { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const out = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('dashboard timeout')), 8000);
      let data = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        data += chunk.toString();
        if (data.trim().startsWith('{')) {
          clearTimeout(timeout);
          resolve(data.trim());
        }
      });
      child.on('error', reject);
    });

    child.kill('SIGTERM');
    const meta = parseJson<{ url: string; port: number }>(out);
    expect(meta.url).toContain('3999');
    expect(meta.port).toBe(3999);
  });
});
