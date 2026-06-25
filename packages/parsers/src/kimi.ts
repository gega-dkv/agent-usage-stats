import path from 'path';
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
  jsonParseWarning,
  normalizeSessionIdFromPath,
  newMessageId,
  streamJsonl,
  shouldStoreRaw,
} from './parser-helpers.js';

type KimiRecord = {
  type?: string;
  model?: string;
  timestamp?: string;
  content?: string;
  token_usage?: {
    input_other?: number;
    output?: number;
    input_cache_read?: number;
    input_cache_creation?: number;
  };
};

export const kimiParser: ProviderParser = {
  provider: 'kimi',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('wire.jsonl')) return false;
    try {
      const line = sample.split('\n').find((l) => l.trim());
      if (!line) return false;
      const r = JSON.parse(line) as KimiRecord;
      return r.type === 'StatusUpdate' || r.token_usage !== undefined;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const messages: NormalizedMessage[] = [];
    const sessionId = normalizeSessionIdFromPath(filePath);

    try {
      await streamJsonl<KimiRecord>(
        filePath,
        (record) => {
          if (record.type !== 'StatusUpdate') return;
          const usage = record.token_usage;
          if (!usage) return;
          const inputTokens = usage.input_other;
          const outputTokens = usage.output;
          const cacheReadTokens = usage.input_cache_read;
          const cacheCreationTokens = usage.input_cache_creation;
          const hasUsage =
            (inputTokens || 0) +
              (outputTokens || 0) +
              (cacheReadTokens || 0) +
              (cacheCreationTokens || 0) >
            0;
          if (!hasUsage) return;

          const role: NormalizedMessage['role'] = 'assistant';
          const privacy = applyPrivacyContent(role, record.content, options);

          messages.push({
            id: newMessageId(),
            sessionId,
            timestamp: record.timestamp,
            role,
            model: record.model || 'kimi-for-coding',
            ...privacy,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            cachedInputTokens: (cacheReadTokens || 0) + (cacheCreationTokens || 0) || undefined,
            usageConfidence: 'exact',
            raw: shouldStoreRaw(options) ? record : undefined,
          });
        },
        (lineNum, error) => warnings.push(jsonParseWarning(filePath, error, lineNum)),
      );
    } catch (error) {
      warnings.push(fileReadWarning(filePath, error));
      return { sessions: [], warnings };
    }

    if (messages.length === 0) {
      return {
        sessions: [],
        warnings: [
          ...warnings,
          {
            file: filePath,
            message: 'No StatusUpdate records with token usage found',
            severity: 'warning',
            code: 'missing-token-fields',
          },
        ],
      };
    }

    return {
      sessions: [
        buildSession(sessionId, 'kimi', messages, {
          sourcePath: filePath,
          storageKind: 'jsonl',
          supportLevel: 'exact-usage',
          usageConfidence: 'exact',
          projectPath: path.dirname(filePath),
          projectName: path.basename(path.dirname(path.dirname(filePath))),
        }),
      ],
      warnings,
    };
  },
};
