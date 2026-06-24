import { openProviderDatabase } from './provider-sqlite.js';
import type { ProviderParser, ParseResult, NormalizedMessage } from '@agent-usage/shared';
import { buildSession, newMessageId } from './parser-helpers.js';
import {
  columnNames,
  findTable,
  pickColumn,
  readNumber,
  unknownSchemaWarning,
} from './sqlite-helpers.js';

export const hermesParser: ProviderParser = {
  provider: 'hermes',

  canParse(filePath: string, _sample: string): boolean {
    return filePath.includes('hermes') && filePath.endsWith('.db');
  },

  async parse(filePath: string): Promise<ParseResult> {
    const opened = openProviderDatabase(filePath);
    if (!opened.ok) return { sessions: [], warnings: [opened.warning] };

    const db = opened.db;
    try {
      const hit = findTable(db, ['session', 'usage', 'state']);
      if (!hit) {
        return {
          sessions: [],
          warnings: [unknownSchemaWarning(filePath, 'Hermes usage table not found')],
        };
      }

      const cols = columnNames(hit.columns);
      const idCol = pickColumn(cols, ['id', 'session_id'])!;
      const inputCol = pickColumn(cols, ['input_tokens', 'input']);
      const outputCol = pickColumn(cols, ['output_tokens', 'output']);
      const cacheReadCol = pickColumn(cols, ['cache_read_tokens', 'cache_read']);
      const cacheWriteCol = pickColumn(cols, ['cache_write_tokens', 'cache_creation_tokens']);
      const reasoningCol = pickColumn(cols, ['reasoning_tokens']);
      const actualCostCol = pickColumn(cols, ['actual_cost', 'recorded_cost']);
      const estimatedCostCol = pickColumn(cols, ['estimated_cost']);
      const messageCountCol = pickColumn(cols, ['message_count']);
      const modelCol = pickColumn(cols, ['model']);

      const rows = db.prepare(`SELECT * FROM ${hit.table}`).all() as Array<Record<string, unknown>>;
      const sessions = rows.map((row) => {
        const sessionId = String(row[idCol]);
        const actualCost = actualCostCol ? readNumber(row[actualCostCol]) : undefined;
        const estimatedCost = estimatedCostCol ? readNumber(row[estimatedCostCol]) : undefined;
        const recordedCost = actualCost ?? estimatedCost;

        const message: NormalizedMessage = {
          id: newMessageId(),
          sessionId,
          role: 'assistant',
          model: modelCol ? String(row[modelCol] || '') || undefined : undefined,
          contentPreview: '[hermes session totals]',
          contentHidden: true,
          inputTokens: inputCol ? readNumber(row[inputCol]) : undefined,
          outputTokens: outputCol ? readNumber(row[outputCol]) : undefined,
          cacheReadTokens: cacheReadCol ? readNumber(row[cacheReadCol]) : undefined,
          cacheCreationTokens: cacheWriteCol ? readNumber(row[cacheWriteCol]) : undefined,
          reasoningTokens: reasoningCol ? readNumber(row[reasoningCol]) : undefined,
          recordedCost,
          usageConfidence: actualCost != null ? 'provider-recorded-cost' : recordedCost != null ? 'provider-recorded-cost' : 'exact',
        };

        return buildSession(sessionId, 'hermes', [message], {
          sourcePath: filePath,
          storageKind: 'sqlite',
          supportLevel: 'exact-usage',
          usageConfidence: actualCost != null ? 'provider-recorded-cost' : 'exact',
          messageCount: messageCountCol ? readNumber(row[messageCountCol]) : 1,
          costs: recordedCost
            ? { recordedCost, currency: 'USD', estimated: actualCost == null }
            : undefined,
        });
      });

      return { sessions, warnings: [] };
    } finally {
      db.close();
    }
  },
};
