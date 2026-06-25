import type { ParserWarning } from '@agent-usage/shared';

export type SqliteDatabase = {
  prepare(sql: string): { all(): unknown[] };
};

export type SqliteColumn = { name: string; type: string };

export function listTables(db: SqliteDatabase): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Run a query and return `[]` on any error (missing table/column, schema drift).
 * Doc §13: drift-proofing for providers whose schema changes between versions
 * (crush, cursor). On failure, optionally record a warning instead of letting
 * the error abort the whole parse.
 */
export function safeQuery(
  db: SqliteDatabase,
  sql: string,
  onWarning?: (warning: ParserWarning) => void,
  filePath?: string,
): Record<string, unknown>[] {
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } catch (error) {
    if (onWarning && filePath) {
      onWarning(
        unknownSchemaWarning(
          filePath,
          `Query failed (${error instanceof Error ? error.message : String(error)}): ${sql}`,
        ),
      );
    }
    return [];
  }
}

export function tableColumns(db: SqliteDatabase, table: string): SqliteColumn[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as SqliteColumn[];
}

export function findTable(
  db: SqliteDatabase,
  nameHints: string[],
): { table: string; columns: SqliteColumn[] } | null {
  for (const table of listTables(db)) {
    const lower = table.toLowerCase();
    if (nameHints.some((hint) => lower.includes(hint))) {
      return { table, columns: tableColumns(db, table) };
    }
  }
  return null;
}

export function columnNames(columns: SqliteColumn[]): string[] {
  return columns.map((c) => c.name);
}

export function pickColumn(columns: string[], candidates: string[]): string | undefined {
  const lower = columns.map((c) => c.toLowerCase());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate.toLowerCase());
    if (idx >= 0) return columns[idx];
  }
  for (const candidate of candidates) {
    const hit = columns.find((c) => c.toLowerCase().includes(candidate.toLowerCase()));
    if (hit) return hit;
  }
  return undefined;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseJsonField(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function unknownSchemaWarning(filePath: string, detail: string): ParserWarning {
  return {
    file: filePath,
    message: detail,
    severity: 'warning',
    code: 'unknown-schema',
  };
}

export function missingTableWarning(filePath: string, table: string): ParserWarning {
  return {
    file: filePath,
    message: `Expected SQLite table not found: ${table}`,
    severity: 'warning',
    code: 'sqlite-table-missing',
  };
}
