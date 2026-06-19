import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeDatabase, refreshUsageRollups } from '@agent-usage/db';
import {
  listUserPrompts,
  getGroupedUsage,
  clonePricingProfile,
  getPricingProfiles,
  getLastScanByProvider,
  getPricingModels,
} from '@agent-usage/db';

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
      .run(
        'm1',
        's1',
        '2026-06-10T10:00:00Z',
        'user',
        'hello world',
        100,
        0,
        0.5,
      );

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
