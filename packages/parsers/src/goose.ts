import { openProviderDatabase } from '@agent-usage/db';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedMessage,
} from '@agent-usage/shared';
import { buildSession, newMessageId } from './parser-helpers.js';
import {
  columnNames,
  findTable,
  parseJsonField,
  pickColumn,
  readNumber,
  unknownSchemaWarning,
} from './sqlite-helpers.js';

export const gooseParser: ProviderParser = {
  provider: 'goose',

  canParse(filePath: string, _sample: string): boolean {
    return filePath.includes('goose') && filePath.endsWith('.db');
  },

  async parse(filePath: string, _options?: ParseOptions): Promise<ParseResult> {
    const opened = openProviderDatabase(filePath);
    if (!opened.ok) return { sessions: [], warnings: [opened.warning] };

    const db = opened.db;
    const warnings: ParseResult['warnings'] = [];
    try {
      const hit = findTable(db, ['session']);
      if (!hit) {
        return {
          sessions: [],
          warnings: [unknownSchemaWarning(filePath, 'Goose sessions table not found')],
        };
      }

      const cols = columnNames(hit.columns);
      const idCol = pickColumn(cols, ['id', 'session_id'])!;
      const inputCol = pickColumn(cols, ['input_tokens', 'accumulated_input_tokens']);
      const outputCol = pickColumn(cols, ['output_tokens', 'accumulated_output_tokens']);
      const totalCol = pickColumn(cols, ['total_tokens']);
      const modelCol = pickColumn(cols, ['model_config_json', 'model_name', 'model']);
      const providerCol = pickColumn(cols, ['provider_name', 'provider']);
      const startedCol = pickColumn(cols, ['created_at', 'started_at']);
      const updatedCol = pickColumn(cols, ['updated_at']);

      const rows = db.prepare(`SELECT * FROM ${hit.table}`).all() as Array<Record<string, unknown>>;
      const sessions = rows.map((row) => {
        const sessionId = String(row[idCol]);
        let inputTokens = inputCol ? readNumber(row[inputCol]) : undefined;
        let outputTokens = outputCol ? readNumber(row[outputCol]) : undefined;
        const totalTokens = totalCol ? readNumber(row[totalCol]) : undefined;
        let reasoningTokens: number | undefined;
        if (
          totalTokens &&
          inputTokens != null &&
          outputTokens != null &&
          totalTokens > inputTokens + outputTokens
        ) {
          reasoningTokens = totalTokens - inputTokens - outputTokens;
        }

        const modelJson = modelCol ? parseJsonField(row[modelCol]) : null;
        const model =
          (modelJson?.model_name as string) ||
          (typeof row[modelCol || ''] === 'string' ? (row[modelCol || ''] as string) : undefined);
        const providerName = providerCol ? String(row[providerCol] || '') : undefined;

        const message: NormalizedMessage = {
          id: newMessageId(),
          sessionId,
          role: 'assistant',
          model,
          contentPreview: '[goose session totals]',
          contentHidden: true,
          inputTokens,
          outputTokens,
          reasoningTokens,
          usageConfidence: inputTokens || outputTokens ? 'exact' : 'unavailable',
          metadata: providerName ? { provider: providerName } : undefined,
        };

        return buildSession(sessionId, 'goose', [message], {
          sourcePath: filePath,
          storageKind: 'sqlite',
          supportLevel: 'exact-usage',
          usageConfidence: 'exact',
          startedAt: startedCol ? String(row[startedCol] || '') : undefined,
          updatedAt: updatedCol ? String(row[updatedCol] || '') : undefined,
        });
      });

      return { sessions, warnings };
    } finally {
      db.close();
    }
  },
};
