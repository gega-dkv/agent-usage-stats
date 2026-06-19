import type { Database as DatabaseType } from 'better-sqlite3';

/** Bump when adding a new incremental migration step below. */
export const CURRENT_SCHEMA_VERSION = 3;

function getStoredVersion(sqlite: DatabaseType): number {
  try {
    const row = sqlite.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    if (!row) return 0;
    const parsed = parseInt(row.value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function setStoredVersion(sqlite: DatabaseType, version: number): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(String(version), now);
}

/** Adds a column to a table if it does not already exist (no-op otherwise). */
export function ensureColumn(
  sqlite: DatabaseType,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  } catch {
    // Table may not exist yet on a brand-new DB; CREATE TABLE handled it.
  }
}

/**
 * Apply incremental schema upgrades for existing stats.db files.
 * Every column change must be documented in schema.ts and connection.ts DDL.
 */
export function runMigrations(sqlite: DatabaseType): number {
  let version = getStoredVersion(sqlite);

  if (version < 1) {
    ensureColumn(sqlite, 'sessions', 'cost_estimated', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'recorded_cost', 'REAL');
    version = 1;
    setStoredVersion(sqlite, version);
  }

  if (version < 2) {
    ensureColumn(sqlite, 'parser_warnings', 'code', 'TEXT');
    version = 2;
    setStoredVersion(sqlite, version);
  }

  if (version < 3) {
    // Session metadata / confidence columns (Phase 1.1)
    ensureColumn(sqlite, 'sessions', 'source_path', 'TEXT');
    ensureColumn(sqlite, 'sessions', 'storage_kind', 'TEXT');
    ensureColumn(sqlite, 'sessions', 'support_level', 'TEXT');
    ensureColumn(sqlite, 'sessions', 'usage_confidence', 'TEXT');
    ensureColumn(sqlite, 'sessions', 'message_count', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'prompt_count', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'session_warnings', 'TEXT');
    ensureColumn(sqlite, 'sessions', 'raw_retention', 'TEXT');
    ensureColumn(sqlite, 'sessions', 'cache_creation_tokens', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'cache_read_tokens', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'tool_tokens', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'token_usage_estimated', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'simulated_cost', 'REAL DEFAULT 0');
    ensureColumn(sqlite, 'sessions', 'pricing_source', 'TEXT');

    // Message estimation / cost columns
    ensureColumn(sqlite, 'messages', 'content_hidden', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'messages', 'cache_creation_tokens', 'INTEGER');
    ensureColumn(sqlite, 'messages', 'cache_read_tokens', 'INTEGER');
    ensureColumn(sqlite, 'messages', 'tool_tokens', 'INTEGER');
    ensureColumn(sqlite, 'messages', 'usage_confidence', 'TEXT');
    ensureColumn(sqlite, 'messages', 'recorded_cost', 'REAL');
    ensureColumn(sqlite, 'messages', 'simulated_cost', 'REAL');
    ensureColumn(sqlite, 'messages', 'cost_estimated', 'INTEGER DEFAULT 0');
    ensureColumn(sqlite, 'messages', 'message_metadata', 'TEXT');

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS scanned_files (
        path TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL,
        last_scanned_at TEXT NOT NULL
      );
    `);

    version = 3;
    setStoredVersion(sqlite, version);
  }

  if (version < CURRENT_SCHEMA_VERSION) {
    setStoredVersion(sqlite, CURRENT_SCHEMA_VERSION);
    version = CURRENT_SCHEMA_VERSION;
  }

  return version;
}

export function getSchemaVersion(sqlite: DatabaseType): number {
  return getStoredVersion(sqlite);
}
