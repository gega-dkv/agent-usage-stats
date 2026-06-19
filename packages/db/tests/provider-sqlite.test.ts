import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeDatabase } from '../src/connection.js';
import {
  isSqliteLockedError,
  openProviderDatabase,
} from '../src/provider-sqlite.js';

describe('openProviderDatabase', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `aus-provider-${Date.now()}.db`);
    const db = initializeDatabase(dbPath);
    db.sqlite.close();
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

  it('opens an existing provider database read-only', () => {
    const result = openProviderDatabase(dbPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.db.close();
    }
  });

  it('returns a typed warning for missing databases', () => {
    const result = openProviderDatabase(path.join(os.tmpdir(), 'missing-provider.db'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warning.code).toBe('sqlite-table-missing');
    }
  });

  it('detects sqlite lock errors', () => {
    expect(isSqliteLockedError(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
    expect(isSqliteLockedError({ code: 'SQLITE_LOCKED', message: 'locked' })).toBe(true);
    expect(isSqliteLockedError(new Error('no such table'))).toBe(false);
  });
});
