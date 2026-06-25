import fs from 'fs';
import path from 'path';
import { openProviderDatabase } from '@agent-usage/db';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedMessage,
} from '@agent-usage/shared';
import {
  applyPrivacyContent,
  buildSession,
  fileReadWarning,
  newMessageId,
  shouldStoreRaw,
} from './parser-helpers.js';
import {
  columnNames,
  listTables,
  parseJsonField,
  pickColumn,
  readNumber,
  tableColumns,
  unknownSchemaWarning,
} from './sqlite-helpers.js';

export const opencodeParser: ProviderParser = {
  provider: 'opencode',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('opencode')) return false;
    if (filePath.endsWith('.db')) return true;
    if (filePath.endsWith('.json')) {
      try {
        const data = JSON.parse(sample);
        return (
          (data as { sessionID?: string }).sessionID !== undefined ||
          (data as { session_id?: string }).session_id !== undefined ||
          (data as { role?: string }).role !== undefined
        );
      } catch {
        return false;
      }
    }
    return false;
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    if (filePath.endsWith('.db')) return parseSqlite(filePath, options);
    if (filePath.endsWith('.json')) return parseLegacyJson(filePath, options);
    return {
      sessions: [],
      warnings: [unknownSchemaWarning(filePath, 'Unsupported OpenCode file format')],
    };
  },
};

async function parseSqlite(filePath: string, options?: ParseOptions): Promise<ParseResult> {
  const opened = openProviderDatabase(filePath);
  if (!opened.ok) return { sessions: [], warnings: [opened.warning] };

  const db = opened.db;
  const warnings: ParseResult['warnings'] = [];
  try {
    const tables = listTables(db);
    const sessionTable = tables.find((t) => t.toLowerCase() === 'session');
    const messageTable = tables.find((t) => t.toLowerCase() === 'message');
    if (!sessionTable || !messageTable) {
      return {
        sessions: [],
        warnings: [
          unknownSchemaWarning(
            filePath,
            `OpenCode schema missing session/message tables (found: ${tables.join(', ')})`,
          ),
        ],
      };
    }

    const msgCols = columnNames(tableColumns(db, messageTable));
    const sessionIdCol = pickColumn(msgCols, ['session_id', 'sessionID'])!;
    const dataCol = pickColumn(msgCols, ['data']);
    const roleCol = pickColumn(msgCols, ['role']);
    const modelCol = pickColumn(msgCols, ['model']);
    const inputCol = pickColumn(msgCols, ['input_tokens', 'prompt_tokens']);
    const outputCol = pickColumn(msgCols, ['output_tokens', 'completion_tokens']);
    const cacheReadCol = pickColumn(msgCols, ['cache_read_tokens', 'cached_tokens']);
    const cacheWriteCol = pickColumn(msgCols, ['cache_creation_tokens', 'cache_write_tokens']);
    const reasoningCol = pickColumn(msgCols, ['reasoning_tokens', 'thoughts_tokens']);
    const idCol = pickColumn(msgCols, ['id'])!;

    const rows = db.prepare(`SELECT * FROM ${messageTable}`).all() as Array<
      Record<string, unknown>
    >;
    const bySession = new Map<string, NormalizedMessage[]>();

    for (const row of rows) {
      const sessionId = String(row[sessionIdCol]);
      const payload = dataCol ? parseJsonField(row[dataCol]) : null;
      const role = mapRole(String(row[roleCol || ''] || payload?.role || 'unknown'));
      const contentText = extractContent(payload);
      const privacy = applyPrivacyContent(role, contentText, options);
      // OpenCode stores usage either as flat columns or as a nested `tokens`/
      // `usage` object in the JSON `data` payload (doc §6.173). Read both.
      const tokens = (payload?.tokens as Record<string, number> | undefined) || {};
      const usage = (payload?.usage as Record<string, number> | undefined) || {};
      const inputTokens = inputCol
        ? readNumber(row[inputCol])
        : readNumber(
            tokens.input ?? tokens.input_tokens ?? usage.input_tokens ?? usage.prompt_tokens,
          );
      const outputTokens = outputCol
        ? readNumber(row[outputCol])
        : readNumber(
            tokens.output ?? tokens.output_tokens ?? usage.output_tokens ?? usage.completion_tokens,
          );
      const cacheReadTokens = cacheReadCol
        ? readNumber(row[cacheReadCol])
        : readNumber(
            tokens.cache_read ??
              tokens.cacheRead ??
              usage.cache_read_tokens ??
              usage.cacheReadTokens,
          );
      const cacheCreationTokens = cacheWriteCol
        ? readNumber(row[cacheWriteCol])
        : readNumber(
            tokens.cache_write ??
              tokens.cacheWrite ??
              usage.cache_creation_tokens ??
              usage.cacheCreationTokens,
          );
      const reasoningTokens = reasoningCol
        ? readNumber(row[reasoningCol])
        : readNumber(
            tokens.reasoning ??
              tokens.reasoning_tokens ??
              usage.reasoning_tokens ??
              usage.reasoningTokens,
          );

      const message: NormalizedMessage = {
        id: String(row[idCol]),
        sessionId,
        role,
        model: modelCol
          ? String(row[modelCol] || '') || undefined
          : String(payload?.model || '') || undefined,
        ...privacy,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cachedInputTokens:
          cacheReadTokens != null || cacheCreationTokens != null
            ? (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)
            : undefined,
        reasoningTokens,
        // Doc §6.175: stored cost is always 0 → ignore and recompute downstream.
        recordedCost: undefined,
        usageConfidence: inputTokens || outputTokens ? 'exact' : 'unavailable',
        raw: shouldStoreRaw(options) ? row : undefined,
      };
      if (!bySession.has(sessionId)) bySession.set(sessionId, []);
      bySession.get(sessionId)!.push(message);
    }

    const sessions = Array.from(bySession.entries()).map(([sessionId, messages]) =>
      buildSession(sessionId, 'opencode', messages, {
        sourcePath: filePath,
        storageKind: 'sqlite',
        supportLevel: messages.some((m) => m.inputTokens || m.outputTokens)
          ? 'exact-usage'
          : 'partial-usage',
        usageConfidence: messages.some((m) => m.inputTokens || m.outputTokens)
          ? 'exact'
          : 'unavailable',
      }),
    );

    return { sessions, warnings };
  } finally {
    db.close();
  }
}

async function parseLegacyJson(filePath: string, options?: ParseOptions): Promise<ParseResult> {
  const warnings: ParseResult['warnings'] = [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const isMessage = filePath.includes('/message/');
    const sessionId = String(
      data.sessionID ||
        data.session_id ||
        (isMessage ? path.basename(path.dirname(filePath)) : path.basename(filePath, '.json')),
    );

    if (isMessage || data.role) {
      const role = mapRole(String(data.role || 'unknown'));
      const contentText = extractContent(data);
      const privacy = applyPrivacyContent(role, contentText, options);
      const tokens = (data.tokens as Record<string, number> | undefined) || {};
      const usage = (data.usage as Record<string, number> | undefined) || {};
      const cacheReadTokens = readNumber(
        tokens.cache_read ?? tokens.cacheRead ?? usage.cache_read_tokens,
      );
      const cacheCreationTokens = readNumber(
        tokens.cache_write ?? tokens.cacheWrite ?? usage.cache_creation_tokens,
      );
      const message: NormalizedMessage = {
        id: String(data.id || newMessageId()),
        sessionId,
        role,
        model: String(data.model || data.provider || '') || undefined,
        ...privacy,
        inputTokens: readNumber(
          tokens.input ?? tokens.input_tokens ?? usage.input_tokens ?? usage.prompt_tokens,
        ),
        outputTokens: readNumber(
          tokens.output ?? tokens.output_tokens ?? usage.output_tokens ?? usage.completion_tokens,
        ),
        cacheReadTokens,
        cacheCreationTokens,
        cachedInputTokens:
          cacheReadTokens != null || cacheCreationTokens != null
            ? (cacheReadTokens ?? 0) + (cacheCreationTokens ?? 0)
            : undefined,
        reasoningTokens: readNumber(
          tokens.reasoning ?? tokens.reasoning_tokens ?? usage.reasoning_tokens,
        ),
        usageConfidence:
          usage.input_tokens || usage.output_tokens || tokens.input || tokens.output
            ? 'exact'
            : 'unavailable',
        raw: shouldStoreRaw(options) ? data : undefined,
      };
      return {
        sessions: [
          buildSession(sessionId, 'opencode', [message], {
            sourcePath: filePath,
            storageKind: 'json',
            supportLevel:
              message.inputTokens || message.outputTokens ? 'exact-usage' : 'partial-usage',
          }),
        ],
        warnings,
      };
    }

    warnings.push({
      file: filePath,
      message: 'OpenCode legacy JSON file missing recognizable session/message shape',
      severity: 'warning',
      code: 'unknown-schema',
    });
    return { sessions: [], warnings };
  } catch (error) {
    warnings.push(fileReadWarning(filePath, error));
    return { sessions: [], warnings };
  }
}

function mapRole(role: string): NormalizedMessage['role'] {
  switch (role.toLowerCase()) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
      return 'tool';
    default:
      return 'unknown';
  }
}

function extractContent(data: Record<string, unknown> | null): string | undefined {
  if (!data) return undefined;
  if (typeof data.content === 'string') return data.content;
  if (Array.isArray(data.parts)) {
    return data.parts
      .map((p) =>
        typeof p === 'object' && p && 'text' in p
          ? String((p as { text?: string }).text || '')
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return undefined;
}
