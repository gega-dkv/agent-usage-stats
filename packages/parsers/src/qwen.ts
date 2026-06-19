import path from 'path';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
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

type QwenRecord = {
  role?: string;
  model?: string;
  parts?: Array<{ text?: string }>;
  text?: string;
  content?: string;
  timestamp?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};

export const qwenParser: ProviderParser = {
  provider: 'qwen',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('.qwen') && !filePath.includes('qwen')) return false;
    if (!filePath.endsWith('.jsonl')) return false;
    try {
      const line = sample.split('\n').find((l) => l.trim());
      if (!line) return false;
      const r = JSON.parse(line) as QwenRecord;
      return r.usageMetadata !== undefined || r.role !== undefined;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const messages: NormalizedMessage[] = [];
    const sessionId = normalizeSessionIdFromPath(filePath);

    try {
      await streamJsonl<QwenRecord>(
        filePath,
        (record) => {
          const role = mapRole(record.role);
          const contentText = record.text || record.content || extractText(record.parts);
          const usage = record.usageMetadata || {};
          const inputTokens = usage.promptTokenCount;
          const outputTokens = usage.candidatesTokenCount;
          const reasoningTokens = usage.thoughtsTokenCount;
          const cacheReadTokens = usage.cachedContentTokenCount;
          const privacy = applyPrivacyContent(role, contentText, options);

          messages.push({
            id: newMessageId(),
            sessionId,
            timestamp: record.timestamp,
            role,
            model: record.model,
            ...privacy,
            inputTokens,
            outputTokens,
            reasoningTokens,
            cacheReadTokens,
            cacheCreationTokens: 0,
            cachedInputTokens: cacheReadTokens,
            usageConfidence: inputTokens || outputTokens ? 'exact' : 'unavailable',
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
      warnings.push({
        file: filePath,
        message: 'No parseable Qwen messages found',
        severity: 'warning',
        code: 'missing-token-fields',
      });
      return { sessions: [], warnings };
    }

    return {
      sessions: [
        buildSession(sessionId, 'qwen', messages, {
          sourcePath: filePath,
          storageKind: 'jsonl',
          supportLevel: 'exact-usage',
          usageConfidence: 'exact',
          projectPath: path.dirname(filePath),
          projectName: path.basename(path.dirname(path.dirname(filePath))),
          startedAt: messages[0]?.timestamp,
          updatedAt: messages[messages.length - 1]?.timestamp,
        }),
      ],
      warnings,
    };
  },
};

function mapRole(role?: string): NormalizedMessage['role'] {
  switch ((role || '').toLowerCase()) {
    case 'user':
      return 'user';
    case 'model':
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      return 'unknown';
  }
}

function extractText(parts?: Array<{ text?: string }>): string {
  if (!parts) return '';
  return parts.filter((p) => p.text).map((p) => p.text!).join('\n');
}
