import fs from 'fs';
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

type PiAgentRecord = {
  sessionId?: string;
  id?: string;
  role?: string;
  model?: string;
  content?: string;
  timestamp?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
  };
  messages?: PiAgentRecord[];
};

export const piAgentParser: ProviderParser = {
  provider: 'pi-agent',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('.pi/agent')) return false;
    if (filePath.endsWith('.jsonl')) {
      try {
        const line = sample.split('\n').find((l) => l.trim());
        if (!line) return false;
        const r = JSON.parse(line) as PiAgentRecord;
        return r.usage !== undefined || r.role !== undefined;
      } catch {
        return false;
      }
    }
    if (filePath.endsWith('.json')) {
      try {
        const data = JSON.parse(sample) as PiAgentRecord;
        return data.usage !== undefined || Array.isArray(data.messages);
      } catch {
        return false;
      }
    }
    return false;
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    if (filePath.endsWith('.jsonl')) {
      return parseJsonl(filePath, options);
    }
    return parseJson(filePath, options);
  },
};

async function parseJsonl(filePath: string, options?: ParseOptions): Promise<ParseResult> {
  const warnings: ParseResult['warnings'] = [];
  const messages: NormalizedMessage[] = [];
  const sessionId = normalizeSessionIdFromPath(filePath);

  try {
    await streamJsonl<PiAgentRecord>(
      filePath,
      (record) => {
        const msg = toMessage(record, sessionId, options);
        if (msg) messages.push(msg);
      },
      (lineNum, error) => warnings.push(jsonParseWarning(filePath, error, lineNum)),
    );
  } catch (error) {
    warnings.push(fileReadWarning(filePath, error));
    return { sessions: [], warnings };
  }

  return finalize(filePath, sessionId, messages, warnings);
}

async function parseJson(filePath: string, options?: ParseOptions): Promise<ParseResult> {
  const warnings: ParseResult['warnings'] = [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PiAgentRecord;
    const sessionId = data.sessionId || data.id || normalizeSessionIdFromPath(filePath);
    const messages: NormalizedMessage[] = [];
    const list = data.messages || [data];
    for (const record of list) {
      const msg = toMessage(record, sessionId, options);
      if (msg) messages.push(msg);
    }
    return finalize(filePath, sessionId, messages, warnings);
  } catch (error) {
    warnings.push(fileReadWarning(filePath, error));
    return { sessions: [], warnings };
  }
}

function toMessage(
  record: PiAgentRecord,
  sessionId: string,
  options?: ParseOptions,
): NormalizedMessage | null {
  const role = record.role === 'user' ? 'user' : record.role === 'assistant' ? 'assistant' : 'unknown';
  if (role === 'unknown' && !record.usage && !record.content) return null;
  const usage = record.usage || {};
  const privacy = applyPrivacyContent(role, record.content, options);
  return {
    id: record.id || newMessageId(),
    sessionId,
    timestamp: record.timestamp,
    role,
    model: record.model,
    ...privacy,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationTokens: usage.cache_creation_tokens,
    cacheReadTokens: usage.cache_read_tokens,
    usageConfidence: usage.input_tokens || usage.output_tokens ? 'exact' : 'metadata-only',
    raw: shouldStoreRaw(options) ? record : undefined,
  };
}

function finalize(
  filePath: string,
  sessionId: string,
  messages: NormalizedMessage[],
  warnings: ParseResult['warnings'],
): ParseResult {
  if (messages.length === 0) {
    return {
      sessions: [],
      warnings: [
        ...warnings,
        {
          file: filePath,
          message: 'No pi-agent usage records found',
          severity: 'warning',
          code: 'missing-token-fields',
        },
      ],
    };
  }
  const hasUsage = messages.some((m) => m.inputTokens || m.outputTokens);
  return {
    sessions: [
      buildSession(sessionId, 'pi-agent', messages, {
        sourcePath: filePath,
        storageKind: filePath.endsWith('.jsonl') ? 'jsonl' : 'json',
        supportLevel: hasUsage ? 'exact-usage' : 'partial-usage',
        usageConfidence: hasUsage ? 'exact' : 'metadata-only',
        projectPath: path.dirname(filePath),
      }),
    ],
    warnings,
  };
}
