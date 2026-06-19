import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NormalizedSession } from '@agent-usage/shared';
import { initializeDatabase, type AppDatabase } from '../src/connection.js';
import {
  upsertSession,
  upsertMessages,
  searchMessages,
  purgeContent,
  getProviderUsageStats,
} from '../src/queries.js';

function makeSession(id: string, content: string): NormalizedSession {
  return {
    id,
    provider: 'claude',
    projectName: 'demo',
    startedAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T01:00:00Z',
    totals: {
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 150,
    },
    messages: [
      {
        id: `${id}-m1`,
        sessionId: id,
        role: 'user',
        contentText: content,
        contentPreview: content.slice(0, 40),
      },
    ],
  };
}

describe('db integration', () => {
  let dbPath: string;
  let database: AppDatabase;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `aus-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

  it('upserts by primary key so re-ingesting a session does not duplicate it', () => {
    const session = makeSession('s1', 'Help me refactor the auth module');
    upsertSession(database.db, session, 'hash-1');
    upsertMessages(database.db, session.id, session.messages);

    // Re-ingest the same session (e.g. file changed) — should update, not insert.
    upsertSession(database.db, session, 'hash-2');

    const count = database.sqlite.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number };
    expect(count.c).toBe(1);
    const row = database.sqlite.prepare('SELECT file_hash FROM sessions WHERE id = ?').get('s1') as {
      file_hash: string;
    };
    expect(row.file_hash).toBe('hash-2');
  });

  it('finds messages through full-text search', () => {
    const session = makeSession('s2', 'Investigate the database connection pool leak');
    upsertSession(database.db, session, 'h');
    upsertMessages(database.db, session.id, session.messages);

    const results = searchMessages(database.db, 'database');
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe('s2');
  });

  it('purges stored content and the search index', () => {
    const session = makeSession('s3', 'Secret prompt about credentials');
    upsertSession(database.db, session, 'h');
    upsertMessages(database.db, session.id, session.messages);

    expect(searchMessages(database.db, 'credentials').length).toBe(1);

    const purged = purgeContent(database.sqlite);
    expect(purged.messages).toBeGreaterThanOrEqual(1);

    expect(searchMessages(database.db, 'credentials').length).toBe(0);
    const row = database.sqlite.prepare('SELECT content_text FROM messages WHERE id = ?').get('s3-m1') as {
      content_text: string | null;
    };
    expect(row.content_text).toBeNull();
  });

  it('aggregates usage stats by provider', () => {
    const a = makeSession('s4', 'one');
    const b = makeSession('s5', 'two');
    upsertSession(database.db, a, 'h1');
    upsertSession(database.db, b, 'h2');

    const stats = getProviderUsageStats(database.db);
    const claude = stats.find((s) => s.provider === 'claude');
    expect(claude?.sessions).toBe(2);
    expect(claude?.totalTokens).toBe(300);
  });
});
