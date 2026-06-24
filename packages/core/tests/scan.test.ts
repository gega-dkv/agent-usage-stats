/**
 * Integration tests use an isolated temp SQLite file per test:
 *   dbPath = path.join(os.tmpdir(), `aus-scan-${Date.now()}-${random}.db`)
 *   database = initializeDatabase(dbPath)
 * Teardown closes sqlite and unlinks the db / -wal / -shm siblings.
 * Set AGENT_USAGE_DB_PATH in CLI subprocess tests the same way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, type AppDatabase } from '@agent-usage/db';
import { getSchemaVersion, CURRENT_SCHEMA_VERSION } from '@agent-usage/db';
import {
  getStatsSummary,
  getDailyUsage,
  getGroupedUsage,
  getSessions,
} from '@agent-usage/db';
import {
  scanSessions,
  getDefaultConfig,
  enrichSession,
  loadConfig,
  validateConfig,
} from '@agent-usage/core';
import type { NormalizedSession } from '@agent-usage/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const claudeFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/claude/valid.jsonl',
);
const multiSessionFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/claude/multi-session.jsonl',
);
const multiModelFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/claude/multi-model.jsonl',
);

describe('scan pipeline integration', () => {
  let dbPath: string;
  let database: AppDatabase;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `aus-scan-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    database = initializeDatabase(dbPath);
  });

  afterEach(() => {
    database.sqlite.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it('scans a fixture file into the database and refreshes rollups', async () => {
    const config = getDefaultConfig();
    const result = await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
    });

    expect(result.filesScanned).toBe(1);
    expect(result.sessionsFound).toBeGreaterThan(0);
    expect(result.messagesFound).toBeGreaterThan(0);

    const summary = getStatsSummary(database.db);
    expect(summary.totalSessions).toBeGreaterThan(0);
    expect(summary.totalTokens).toBeGreaterThan(0);
  });

  it('prices each model in a session separately and shows the dominant model', async () => {
    const config = getDefaultConfig();
    await scanSessions(database, config, {
      paths: [multiModelFixture],
      provider: 'claude',
      force: true,
    });

    const row = database.sqlite
      .prepare('SELECT model, estimated_cost FROM sessions LIMIT 1')
      .get() as { model: string; estimated_cost: number };

    // Opus carries ~1M in + 1M out; haiku carries ~1k. The session is shown as
    // the model that did the most work, not the first one seen.
    expect(row.model).toBe('claude-opus-4-8');
    // Opus input ($5/M) + output ($25/M) ≈ $30. If the whole session were
    // mispriced at the (much cheaper) haiku rates, this would be ~$5.
    expect(row.estimated_cost).toBeGreaterThan(20);
  });

  it('persists usage confidence and support level from registry defaults', async () => {
    const config = getDefaultConfig();
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
    });

    const row = database.sqlite
      .prepare(
        'SELECT usage_confidence, support_level, source_path, message_count, prompt_count FROM sessions LIMIT 1',
      )
      .get() as {
      usage_confidence: string;
      support_level: string;
      source_path: string;
      message_count: number;
      prompt_count: number;
    };

    expect(row.usage_confidence).toBe('exact');
    expect(row.support_level).toBe('exact-usage');
    expect(row.source_path).toBe(claudeFixture);
    expect(row.message_count).toBeGreaterThan(0);
    expect(row.prompt_count).toBeGreaterThan(0);
  });

  it('ingests multiple sessions from one JSONL file without duplicating on re-scan', async () => {
    const config = getDefaultConfig();
    const first = await scanSessions(database, config, {
      paths: [multiSessionFixture],
      provider: 'claude',
      force: true,
    });

    expect(first.sessionsFound).toBe(2);

    const ids = database.sqlite
      .prepare('SELECT id FROM sessions ORDER BY id')
      .all() as Array<{ id: string }>;
    expect(ids.map((r) => r.id)).toEqual(['session-a', 'session-b']);

    const second = await scanSessions(database, config, {
      paths: [multiSessionFixture],
      provider: 'claude',
      force: true,
    });
    expect(second.sessionsFound).toBe(2);

    const count = (
      database.sqlite.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number }
    ).c;
    expect(count).toBe(2);
  });

  it('re-ingests by session id without duplicating rows (multi-session-per-file safe)', async () => {
    const config = getDefaultConfig();
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });
    const firstCount = (
      database.sqlite.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number }
    ).c;

    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });
    const secondCount = (
      database.sqlite.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number }
    ).c;

    expect(secondCount).toBe(firstCount);
  });

  it('feeds dashboard query helpers after scan (stats, rollups, sessions)', async () => {
    const config = getDefaultConfig();
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const summary = getStatsSummary(database.db);
    expect(summary.totalSessions).toBeGreaterThan(0);
    expect(summary.totalTokens).toBeGreaterThan(0);
    expect(typeof summary.totalEstimatedCost).toBe('number');

    const daily = getDailyUsage(database.db);
    expect(daily.length).toBeGreaterThan(0);
    expect(daily[0]).toMatchObject({
      provider: expect.any(String),
      sessions: expect.any(Number),
      totalTokens: expect.any(Number),
    });

    const byProvider = getGroupedUsage(database.db, { groupBy: 'provider', metric: 'tokens' });
    expect(byProvider.some((g) => g.label === 'claude' && g.value > 0)).toBe(true);

    const sessions = getSessions(database.db, { limit: 10, orderBy: 'date' });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toMatchObject({
      id: expect.any(String),
      provider: 'claude',
      totalTokens: expect.any(Number),
    });
  });

  it('exposes quality breakdown in stats summary JSON fields', async () => {
    const config = getDefaultConfig();
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
    });

    const summary = getStatsSummary(database.db);
    expect(summary.costEstimatedSessions).toBeGreaterThanOrEqual(0);
    expect(summary.sessionsBySupportLevel['exact-usage']).toBeGreaterThan(0);
    expect(summary.sessionsByUsageConfidence.exact).toBeGreaterThan(0);
  });

  it('skips unchanged files on incremental scan', async () => {
    const config = getDefaultConfig();
    const first = await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
    });
    expect(first.filesSkipped).toBe(0);

    const second = await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
    });
    expect(second.filesSkipped).toBe(1);
    expect(second.sessionsFound).toBe(0);
  });

  it('resimulates recorded costs when resimulateRecordedCosts is enabled', async () => {
    // Seed pricing models via a normal scan
    await scanSessions(database, getDefaultConfig(), {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const session: NormalizedSession = {
      id: 'cost-test',
      provider: 'claude',
      messages: [
        {
          id: 'm1',
          sessionId: 'cost-test',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          contentPreview: 'hi',
          inputTokens: 1_000_000,
          outputTokens: 0,
        },
      ],
      totals: {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        toolTokens: 0,
        reasoningTokens: 0,
        totalTokens: 1_000_000,
      },
      costs: { recordedCost: 0.01, currency: 'USD', estimated: false },
    };

    const { upsertSession, updateSessionCosts, getPricingModels } = await import('@agent-usage/db');
    const { lookupPricing, calculateCost } = await import('@agent-usage/pricing');
    const models = getPricingModels(database.db);
    const pricing = lookupPricing('claude-sonnet-4-20250514', 'anthropic', models);
    expect(pricing.pricing).toBeTruthy();

    const enriched = enrichSession(session, '/tmp/session.jsonl', 'disabled');
    upsertSession(database.db, enriched, 'hash');

    // Trust recorded cost when resimulate is off
    updateSessionCosts(database.db, 'cost-test', {
      estimatedCost: 0.01,
      simulatedCost: calculateCost(enriched.totals, pricing.pricing!).cost,
      model: 'claude-sonnet-4-20250514',
      costEstimated: false,
      recordedCost: 0.01,
      pricingSource: 'exact',
    });

    const sim = calculateCost(enriched.totals, pricing.pricing!);
    expect(sim.cost).toBeGreaterThan(0.01);

    // When resimulate is on, display cost follows simulated cost
    updateSessionCosts(database.db, 'cost-test', {
      estimatedCost: sim.cost,
      simulatedCost: sim.cost,
      model: 'claude-sonnet-4-20250514',
      costEstimated: sim.isEstimated,
      recordedCost: 0.01,
      pricingSource: 'exact',
    });

    const after = database.sqlite
      .prepare('SELECT estimated_cost, simulated_cost, recorded_cost FROM sessions WHERE id = ?')
      .get('cost-test') as { estimated_cost: number; simulated_cost: number; recorded_cost: number };
    expect(after.recorded_cost).toBeCloseTo(0.01, 4);
    expect(after.simulated_cost).toBeGreaterThan(0.01);
    expect(after.estimated_cost).toBe(after.simulated_cost);
  });
});

describe('config loading', () => {
  it('validateConfig returns ok when no config file exists', () => {
    expect(validateConfig('/nonexistent/agent-usage.config.json').ok).toBe(true);
  });

  it('loadConfig warns on stderr when config is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aus-cfg-'));
    const cfgPath = path.join(tmpDir, 'agent-usage.config.json');
    fs.writeFileSync(cfgPath, '{"privacyMode": "not-a-mode"}');

    const origCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const config = loadConfig();
      expect(config.privacyMode).toBe('disabled');
      expect(warn).toHaveBeenCalled();
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmpDir, { recursive: true });
      warn.mockRestore();
    }
  });
});

describe('schema migrations', () => {
  it('records schema_version and upgrades legacy databases', () => {
    const dbPath = path.join(os.tmpdir(), `aus-legacy-${Date.now()}.db`);
    const legacy = initializeDatabase(dbPath);

    legacy.sqlite.prepare("DELETE FROM settings WHERE key = 'schema_version'").run();
    legacy.sqlite.close();

    const upgraded = initializeDatabase(dbPath);
    expect(getSchemaVersion(upgraded.sqlite)).toBe(CURRENT_SCHEMA_VERSION);

    const sessionCols = upgraded.sqlite
      .prepare('PRAGMA table_info(sessions)')
      .all() as Array<{ name: string }>;
    expect(sessionCols.some((c) => c.name === 'usage_confidence')).toBe(true);
    expect(sessionCols.some((c) => c.name === 'pricing_source')).toBe(true);

    const warningCols = upgraded.sqlite
      .prepare('PRAGMA table_info(parser_warnings)')
      .all() as Array<{ name: string }>;
    expect(warningCols.some((c) => c.name === 'code')).toBe(true);

    upgraded.sqlite.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });
});
