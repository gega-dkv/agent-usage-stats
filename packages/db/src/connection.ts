import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

export type DbInstance = BetterSQLite3Database<typeof schema>;

export type AppDatabase = {
  db: DbInstance;
  sqlite: DatabaseType;
  path: string;
};

export function getDefaultDbPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const appDir = path.join(configDir, 'agent-usage-stats');
  fs.mkdirSync(appDir, { recursive: true });
  return path.join(appDir, 'stats.db');
}

export function createDatabase(dbPath?: string): AppDatabase {
  const resolvedPath = dbPath || process.env.AGENT_USAGE_DB_PATH || getDefaultDbPath();
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(resolvedPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  return { db, sqlite, path: resolvedPath };
}

export function initializeDatabase(dbPath?: string): AppDatabase {
  const { db, sqlite, path: resolvedPath } = createDatabase(dbPath);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      paths TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      file_hash TEXT,
      project_path TEXT,
      project_name TEXT,
      started_at TEXT,
      updated_at TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_input_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0,
      model TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      timestamp TEXT,
      role TEXT NOT NULL,
      model TEXT,
      content_text TEXT,
      content_preview TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cached_input_tokens INTEGER,
      reasoning_tokens INTEGER,
      tool_name TEXT,
      tool_input_preview TEXT,
      tool_output_preview TEXT,
      raw TEXT,
      estimated_cost REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS usage_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      project_name TEXT,
      sessions INTEGER DEFAULT 0,
      prompts INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_input_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS usage_monthly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      project_name TEXT,
      sessions INTEGER DEFAULT 0,
      prompts INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_input_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS usage_yearly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      project_name TEXT,
      sessions INTEGER DEFAULT 0,
      prompts INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cached_input_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      estimated_cost REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pricing_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      currency TEXT DEFAULT 'USD',
      input_per_million REAL NOT NULL,
      output_per_million REAL NOT NULL,
      cached_input_per_million REAL,
      cache_write_per_million REAL,
      reasoning_per_million REAL,
      profile TEXT DEFAULT 'api-standard',
      notes TEXT,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      provider TEXT,
      files_scanned INTEGER DEFAULT 0,
      sessions_found INTEGER DEFAULT 0,
      messages_found INTEGER DEFAULT 0,
      warnings_count INTEGER DEFAULT 0,
      errors TEXT
    );

    CREATE TABLE IF NOT EXISTS parser_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_run_id INTEGER REFERENCES scan_runs(id),
      file TEXT NOT NULL,
      line INTEGER,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_provider ON sessions(provider);
    CREATE INDEX IF NOT EXISTS idx_sessions_model ON sessions(model);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_name);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_provider_hash ON sessions(provider, file_hash);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily(date);
    CREATE INDEX IF NOT EXISTS idx_usage_daily_provider ON usage_daily(provider);
    CREATE INDEX IF NOT EXISTS idx_usage_daily_date_provider ON usage_daily(date, provider);
    CREATE INDEX IF NOT EXISTS idx_usage_monthly_month ON usage_monthly(month);
    CREATE INDEX IF NOT EXISTS idx_usage_monthly_provider ON usage_monthly(provider);
    CREATE INDEX IF NOT EXISTS idx_usage_yearly_year ON usage_yearly(year);
    CREATE INDEX IF NOT EXISTS idx_usage_yearly_provider ON usage_yearly(provider);
    CREATE INDEX IF NOT EXISTS idx_warnings_scan_run ON parser_warnings(scan_run_id);
  `);

  return { db, sqlite, path: resolvedPath };
}
