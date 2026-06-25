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

type OpenClawRecord = {
  type?: string;
  role?: string;
  model?: string;
  provider?: string;
  content?: string | Array<{ text?: string }>;
  usage?: { input?: number; output?: number; input_tokens?: number; output_tokens?: number };
  cost?: { total?: number };
  timestamp?: string;
};

export const openclawParser: ProviderParser = {
  provider: 'openclaw',

  canParse(filePath: string, sample: string): boolean {
    const pathHit =
      filePath.includes('.openclaw') ||
      filePath.includes('.clawdbot') ||
      filePath.includes('.moltbot') ||
      filePath.includes('.moldbot');
    if (!pathHit || !filePath.endsWith('.jsonl')) return false;
    try {
      const line = sample.split('\n').find((l) => l.trim());
      if (!line) return false;
      const r = JSON.parse(line) as OpenClawRecord;
      return (
        r.type === 'model_change' ||
        r.type === 'model-snapshot' ||
        r.type === 'custom' ||
        r.role !== undefined ||
        r.usage !== undefined
      );
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const messages: NormalizedMessage[] = [];
    const sessionId = normalizeSessionIdFromPath(filePath);
    let currentModel: string | undefined;
    let recordedCost = 0;

    try {
      await streamJsonl<OpenClawRecord>(
        filePath,
        (record) => {
          if (
            record.type === 'model_change' ||
            record.type === 'model-snapshot' ||
            record.type === 'custom'
          ) {
            if (record.model) currentModel = record.model;
            return;
          }

          const role = mapRole(record.role);
          if (role === 'unknown' && !record.usage) return;

          const contentText = extractContent(record.content);
          const usage = record.usage || {};
          const inputTokens = usage.input ?? usage.input_tokens;
          const outputTokens = usage.output ?? usage.output_tokens;
          if (record.cost?.total) recordedCost += record.cost.total;
          const privacy = applyPrivacyContent(role, contentText, options);

          messages.push({
            id: newMessageId(),
            sessionId,
            timestamp: record.timestamp,
            role,
            model: record.model || currentModel,
            ...privacy,
            inputTokens,
            outputTokens,
            usageConfidence: inputTokens || outputTokens ? 'exact' : 'unavailable',
            recordedCost: record.cost?.total,
            metadata: record.provider ? { provider: record.provider } : undefined,
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
            message: 'No message records found in OpenClaw session log',
            severity: 'warning',
            code: 'missing-token-fields',
          },
        ],
      };
    }

    return {
      sessions: [
        buildSession(sessionId, 'openclaw', messages, {
          sourcePath: filePath,
          storageKind: 'jsonl',
          supportLevel: 'partial-usage',
          usageConfidence: recordedCost > 0 ? 'provider-recorded-cost' : 'exact',
          projectPath: path.dirname(filePath),
          projectName: path.basename(path.dirname(path.dirname(filePath))),
          costs: recordedCost ? { recordedCost, currency: 'USD', estimated: false } : undefined,
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
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      return 'unknown';
  }
}

function extractContent(content?: string | Array<{ text?: string }>): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}
