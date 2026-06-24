import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeDatabase, refreshUsageRollups } from '@agent-usage/db';
import {
  listUserPrompts,
  getGroupedUsage,
  getModelCostBreakdown,
  clonePricingProfile,
  getPricingProfiles,
  getLastScanByProvider,
  getPricingModels,
  getStatsSummary,
  getDailyUsage,
  getSessions,
  getSessionMessages,
  getScanRuns,
  getScanRun,
  getProviderUsageStats,
  getParserWarnings,
  getSetting,
  setSetting,
  searchMessages,
} from '@agent-usage/db';
import { scanSessions, getDefaultConfig } from '@agent-usage/core';
import { fileURLToPath } from 'url';

const claudeFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/parsers/tests/fixtures/claude/valid.jsonl',
);

describe('web query helpers', () => {
  let dbPath: string;
  let db: ReturnType<typeof initializeDatabase>['db'];
  let sqlite: ReturnType<typeof initializeDatabase>['sqlite'];

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `aus-web-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const init = initializeDatabase(dbPath);
    db = init.db;
    sqlite = init.sqlite;

    sqlite
      .prepare(
        `INSERT INTO sessions (
          id, provider, project_name, updated_at, input_tokens, output_tokens,
          total_tokens, estimated_cost, model, usage_confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        's1',
        'claude',
        'proj-a',
        '2026-06-10T10:00:00Z',
        100,
        50,
        150,
        1.5,
        'claude-sonnet',
        'exact',
        '2026-06-10T10:00:00Z',
      );

    sqlite
      .prepare(
        `INSERT INTO messages (
          id, session_id, timestamp, role, content_preview, input_tokens, output_tokens, simulated_cost
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('m1', 's1', '2026-06-10T10:00:00Z', 'user', 'hello world', 100, 0, 0.5);

    sqlite
      .prepare(
        `INSERT INTO pricing_models (
          provider, model, currency, input_per_million, output_per_million,
          profile, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('openai', 'gpt-test', 'USD', 1, 2, 'api-standard', '2026-01-01', '2026-01-01');

    refreshUsageRollups(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('listUserPrompts returns user messages without search query', () => {
    const prompts = listUserPrompts(db, { limit: 10 });
    expect(prompts.length).toBe(1);
    expect(prompts[0].contentPreview).toBe('hello world');
    expect(prompts[0].provider).toBe('claude');
  });

  it('getGroupedUsage groups by provider with cost metric', () => {
    const grouped = getGroupedUsage(db, {
      groupBy: 'provider',
      metric: 'cost',
    });
    expect(grouped.some((g) => g.label === 'claude' && g.value > 0)).toBe(true);
  });

  it('getPricingProfiles lists profiles', () => {
    const profiles = getPricingProfiles(db);
    expect(profiles).toContain('api-standard');
  });

  it('clonePricingProfile copies models to new profile', () => {
    const cloned = clonePricingProfile(db, 'api-standard', 'custom-copy');
    expect(cloned).toBe(1);
    const copy = getPricingModels(db, 'custom-copy');
    expect(copy.length).toBe(1);
  });

  it('getLastScanByProvider returns empty map when no scans', () => {
    const map = getLastScanByProvider(db);
    expect(map.size).toBe(0);
  });
});

describe('web API response contracts (query layer)', () => {
  let dbPath: string;
  let db: ReturnType<typeof initializeDatabase>['db'];
  let sqlite: ReturnType<typeof initializeDatabase>['sqlite'];

  beforeEach(async () => {
    dbPath = path.join(
      os.tmpdir(),
      `aus-web-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    const init = initializeDatabase(dbPath);
    db = init.db;
    sqlite = init.sqlite;

    const config = { ...getDefaultConfig(), privacyMode: 'full' as const };
    await scanSessions(init, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });
  });

  afterEach(() => {
    sqlite.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it('stats API shape: summary, timeSeries, grouped, quality', () => {
    const summary = getStatsSummary(db);
    const timeSeries = getDailyUsage(db);
    const grouped = getGroupedUsage(db, { groupBy: 'provider', metric: 'tokens' });

    expect(summary).toMatchObject({
      totalSessions: expect.any(Number),
      totalTokens: expect.any(Number),
      sessionsByUsageConfidence: expect.any(Object),
      sessionsBySupportLevel: expect.any(Object),
    });
    expect(timeSeries.length).toBeGreaterThan(0);
    expect(grouped.some((g) => g.label === 'claude')).toBe(true);

    const quality = {
      metadataOnlyCount: summary.sessionsByUsageConfidence?.['metadata-only'] ?? 0,
      costEstimatedSessions: summary.costEstimatedSessions,
      sessionsByUsageConfidence: summary.sessionsByUsageConfidence,
    };
    expect(typeof quality.costEstimatedSessions).toBe('number');
  });

  it('cost-by-model breakdown carries non-zero tokens and sessions per model', () => {
    // Regression: the "Cost by model" card used to show "0 tokens 0 sessions"
    // because the API returned only {label, value} (cost). The breakdown must
    // now include tokens + a count(*) session count that does not overcount.
    const breakdown = getModelCostBreakdown(db);

    expect(breakdown.length).toBeGreaterThan(0);
    const row = breakdown.find((r) => r.label.includes('claude-sonnet')) ?? breakdown[0];
    expect(row.tokens).toBeGreaterThan(0);
    expect(row.sessions).toBeGreaterThan(0);
    // shape contract: each row carries all four fields.
    expect(row).toMatchObject({
      label: expect.any(String),
      value: expect.any(Number),
      tokens: expect.any(Number),
      sessions: expect.any(Number),
    });

    // Summing per-model session counts must equal the total distinct session
    // count (a sum over the daily rollup would overcount multi-day sessions).
    const sumModelSessions = breakdown.reduce((sum, r) => sum + r.sessions, 0);
    const summary = getStatsSummary(db);
    expect(sumModelSessions).toBe(summary.totalSessions);
  });

  it('sessions API shape: list and detail messages', () => {
    const sessions = getSessions(db, { limit: 10, orderBy: 'date' }).map((session) => ({
      id: session.id,
      provider: session.provider,
      totalTokens: session.totalTokens,
      usageConfidence: session.usageConfidence,
      supportLevel: session.supportLevel,
    }));
    expect(sessions.length).toBeGreaterThan(0);

    const messages = getSessionMessages(db, sessions[0].id);
    expect(Array.isArray(messages)).toBe(true);
  });

  it('prompts API shape: list and search', () => {
    const listed = listUserPrompts(db, { limit: 20 });
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]).toMatchObject({
      id: expect.any(String),
      contentPreview: expect.any(String),
      provider: 'claude',
    });

    const searched = searchMessages(db, 'hello', { limit: 10 });
    expect(Array.isArray(searched)).toBe(true);
  });

  it('pricing API shape: models and profiles', () => {
    const models = getPricingModels(db);
    const profiles = getPricingProfiles(db);
    expect(Array.isArray(models)).toBe(true);
    expect(profiles.length).toBeGreaterThan(0);
  });

  it('providers API shape: usage stats and warnings', () => {
    const stats = getProviderUsageStats(db);
    expect(stats.some((s) => s.provider === 'claude')).toBe(true);

    const warnings = getParserWarnings(db, { limit: 10 });
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('settings API shape: privacy mode from settings table', () => {
    setSetting(db, 'privacyMode', 'preview');
    const privacyMode = getSetting(db, 'privacyMode') ?? getDefaultConfig().privacyMode;
    expect(privacyMode).toBe('preview');
  });

  it('scan status API shape: latest run and run by id', () => {
    const runs = getScanRuns(db, 1);
    expect(runs.length).toBeGreaterThan(0);
    const latest = runs[0];
    expect(latest).toMatchObject({
      id: expect.any(Number),
      status: expect.any(String),
      filesScanned: expect.any(Number),
    });

    const run = getScanRun(db, latest.id);
    expect(run?.id).toBe(latest.id);
  });
});
