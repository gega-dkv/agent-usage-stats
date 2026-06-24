import fs from 'fs';
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
    const isJsonl = filePath.endsWith('.jsonl');
    const isJson = filePath.endsWith('.json');
    if (!isJsonl && !isJson) return false;
    try {
      // JSONL: inspect the first non-blank line as a record.
      if (isJsonl) {
        const line = sample.split('\n').find((l) => l.trim());
        if (!line) return false;
        const r = JSON.parse(line) as QwenRecord;
        return r.usageMetadata !== undefined || r.role !== undefined;
      }
      // Whole-file JSON (Gemini-style session file): array of records, or an
      // object with usageMetadata / messages / parts.
      const data = JSON.parse(sample);
      if (Array.isArray(data)) {
        return data.some(
          (m) =>
            (m as QwenRecord)?.usageMetadata !== undefined || (m as QwenRecord)?.role !== undefined,
        );
      }
      if (data && typeof data === 'object') {
        return (
          (data as { usageMetadata?: unknown }).usageMetadata !== undefined ||
          Array.isArray((data as { messages?: unknown[] }).messages)
        );
      }
      return false;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const messages: NormalizedMessage[] = [];
    const sessionId = normalizeSessionIdFromPath(filePath);
    const isWholeFileJson = filePath.endsWith('.json');

    const pushRecord = (record: QwenRecord) => {
      const msg = qwenRecordToMessage(record, sessionId, options);
      if (msg) messages.push(msg);
    };

    try {
      if (isWholeFileJson) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const records: QwenRecord[] = Array.isArray(data)
          ? data
          : Array.isArray((data as { messages?: QwenRecord[] }).messages)
            ? (data as { messages: QwenRecord[] }).messages
            : [data];
        for (const record of records) pushRecord(record);
      } else {
        await streamJsonl<QwenRecord>(filePath, pushRecord, (lineNum, error) =>
          warnings.push(jsonParseWarning(filePath, error, lineNum)),
        );
      }
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
          storageKind: isWholeFileJson ? 'json' : 'jsonl',
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

/**
 * Convert one Qwen (Gemini-fork) record into a normalized message.
 * Qwen's promptTokenCount (input) INCLUDES cached content (§2/§5 of
 * ai-cli-token-parsers.md), so the cached portion is split off into
 * cacheReadTokens and subtracted from input to avoid double-counting.
 */
function qwenRecordToMessage(
  record: QwenRecord,
  sessionId: string,
  options?: ParseOptions,
): NormalizedMessage | null {
  const role = mapRole(record.role);
  const contentText = record.text || record.content || extractText(record.parts);
  const usage = record.usageMetadata || {};
  const cacheReadTokens = usage.cachedContentTokenCount;
  const rawInput = usage.promptTokenCount;
  const inputTokens =
    rawInput != null
      ? cacheReadTokens != null
        ? Math.max(0, rawInput - cacheReadTokens)
        : rawInput
      : undefined;
  const outputTokens = usage.candidatesTokenCount;
  const reasoningTokens = usage.thoughtsTokenCount;
  const privacy = applyPrivacyContent(role, contentText, options);

  return {
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
  };
}

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
  return parts
    .filter((p) => p.text)
    .map((p) => p.text!)
    .join('\n');
}
