import { openProviderDatabase } from '@agent-usage/db';
import type { ProviderParser, ParseResult, NormalizedMessage } from '@agent-usage/shared';
import { buildSession, newMessageId } from './parser-helpers.js';
import {
  columnNames,
  findTable,
  pickColumn,
  readNumber,
  unknownSchemaWarning,
} from './sqlite-helpers.js';

export const kiloParser: ProviderParser = {
  provider: 'kilo',

  canParse(filePath: string, _sample: string): boolean {
    return filePath.includes('kilo') && filePath.endsWith('.db');
  },

  async parse(filePath: string): Promise<ParseResult> {
    const opened = openProviderDatabase(filePath);
    if (!opened.ok) return { sessions: [], warnings: [opened.warning] };

    const db = opened.db;
    try {
      const hit = findTable(db, ['message', 'session', 'chat']);
      if (!hit) {
        return {
          sessions: [],
          warnings: [unknownSchemaWarning(filePath, 'Kilo message/session table not found')],
        };
      }

      const cols = columnNames(hit.columns);
      const sessionCol = pickColumn(cols, ['session_id', 'conversation_id', 'id']);
      const inputCol = pickColumn(cols, ['input_tokens', 'prompt_tokens']);
      const outputCol = pickColumn(cols, ['output_tokens', 'completion_tokens']);
      const cacheReadCol = pickColumn(cols, ['cache_read_tokens', 'cached_tokens']);
      const cacheWriteCol = pickColumn(cols, ['cache_creation_tokens', 'cache_write_tokens']);
      const reasoningCol = pickColumn(cols, ['reasoning_tokens', 'thoughts_tokens']);
      const costCol = pickColumn(cols, ['cost', 'recorded_cost', 'total_cost']);
      const modelCol = pickColumn(cols, ['model']);
      const roleCol = pickColumn(cols, ['role']);
      const tsCol = pickColumn(cols, ['created_at', 'timestamp']);

      const rows = db.prepare(`SELECT * FROM ${hit.table}`).all() as Array<Record<string, unknown>>;
      const bySession = new Map<string, NormalizedMessage[]>();

      for (const row of rows) {
        const sessionId = String(row[sessionCol || 'id']);
        const recordedCost = costCol ? readNumber(row[costCol]) : undefined;
        const role =
          roleCol && String(row[roleCol]).toLowerCase() === 'user' ? 'user' : 'assistant';
        const message: NormalizedMessage = {
          id: newMessageId(),
          sessionId,
          role,
          timestamp: tsCol ? String(row[tsCol] || '') || undefined : undefined,
          model: modelCol ? String(row[modelCol] || '') || undefined : undefined,
          contentPreview: `[${role} message]`,
          contentHidden: true,
          inputTokens: inputCol ? readNumber(row[inputCol]) : undefined,
          outputTokens: outputCol ? readNumber(row[outputCol]) : undefined,
          cacheReadTokens: cacheReadCol ? readNumber(row[cacheReadCol]) : undefined,
          cacheCreationTokens: cacheWriteCol ? readNumber(row[cacheWriteCol]) : undefined,
          reasoningTokens: reasoningCol ? readNumber(row[reasoningCol]) : undefined,
          recordedCost,
          usageConfidence: recordedCost != null ? 'provider-recorded-cost' : 'exact',
        };
        if (!bySession.has(sessionId)) bySession.set(sessionId, []);
        bySession.get(sessionId)!.push(message);
      }

      const sessions = Array.from(bySession.entries()).map(([sessionId, messages]) => {
        const recordedCost =
          messages.reduce((sum, m) => sum + (m.recordedCost || 0), 0) || undefined;
        return buildSession(sessionId, 'kilo', messages, {
          sourcePath: filePath,
          storageKind: 'sqlite',
          supportLevel: 'exact-usage',
          usageConfidence: recordedCost ? 'provider-recorded-cost' : 'exact',
          costs: recordedCost ? { recordedCost, currency: 'USD', estimated: false } : undefined,
        });
      });

      return { sessions, warnings: [] };
    } finally {
      db.close();
    }
  },
};
