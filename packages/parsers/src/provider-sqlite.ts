import Database from 'better-sqlite3';
import type { ParserWarning } from '@agent-usage/shared';

export type OpenProviderDatabaseResult =
  | { ok: true; db: Database.Database }
  | { ok: false; warning: ParserWarning };

/** Returns true when a better-sqlite3 open failure looks like a lock/contention error. */
export function isSqliteLockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
  return (
    code === 'SQLITE_BUSY' ||
    code === 'SQLITE_LOCKED' ||
    /database is locked/i.test(message) ||
    /SQLITE_BUSY/i.test(message) ||
    /SQLITE_LOCKED/i.test(message)
  );
}

/**
 * Open a provider-owned SQLite database read-only.
 * Phase 2 parsers should use this instead of calling better-sqlite3 directly so
 * lock contention surfaces as a typed parser warning rather than a scan error.
 */
export function openProviderDatabase(
  filePath: string,
  options?: { readonly?: boolean },
): OpenProviderDatabaseResult {
  try {
    const db = new Database(filePath, {
      readonly: options?.readonly ?? true,
      fileMustExist: true,
    });
    return { ok: true, db };
  } catch (error) {
    if (isSqliteLockedError(error)) {
      return {
        ok: false,
        warning: {
          file: filePath,
          message: `Provider database is locked by another process: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: 'warning',
          code: 'sqlite-locked',
        },
      };
    }

    return {
      ok: false,
      warning: {
        file: filePath,
        message: `Failed to open provider database: ${
          error instanceof Error ? error.message : String(error)
        }`,
        severity: 'error',
        code: 'sqlite-table-missing',
      },
    };
  }
}