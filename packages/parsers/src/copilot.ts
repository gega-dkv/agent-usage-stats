import path from 'path';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
import {
  applyPrivacyContent,
  buildSession,
  fileReadWarning,
  jsonParseWarning,
  newMessageId,
  streamJsonl,
  shouldStoreRaw,
} from './parser-helpers.js';

type OtelSpan = {
  name?: string;
  trace_id?: string;
  span_id?: string;
  attributes?: Record<string, unknown>;
  'attributes.model'?: string;
  resource?: { attributes?: Record<string, unknown> };
};

export const copilotParser: ProviderParser = {
  provider: 'copilot',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('copilot') || !filePath.endsWith('.jsonl')) return false;
    try {
      const line = sample.split('\n').find((l) => l.trim());
      if (!line) return false;
      const r = JSON.parse(line) as OtelSpan;
      return (
        r.name !== undefined ||
        r.attributes !== undefined ||
        r.trace_id !== undefined ||
        sample.includes('gen_ai') ||
        sample.includes('copilot')
      );
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const sessions = new Map<string, NormalizedMessage[]>();

    try {
      await streamJsonl<OtelSpan>(
        filePath,
        (record) => {
          const attrs = { ...record.attributes, ...flattenOtel(record) };
          const spanKind = String(attrs['span.kind'] || record.name || '').toLowerCase();
          const isChat = spanKind.includes('chat') || String(record.name).includes('chat');
          const isInference =
            spanKind.includes('inference') || String(record.name).includes('inference');
          const isAgentTurn = spanKind.includes('agent') || String(record.name).includes('agent');
          if (!isChat && !isInference && !isAgentTurn) return;

          const sessionId = String(
            attrs['session.id'] || attrs['copilot.session_id'] || attrs['gen_ai.conversation.id'] || 'copilot',
          );
          const model = String(attrs['gen_ai.request.model'] || attrs['model'] || attrs['ai.model'] || '');
          const inputTokens = num(attrs['gen_ai.usage.input_tokens'] ?? attrs['input_tokens']);
          const outputTokens = num(attrs['gen_ai.usage.output_tokens'] ?? attrs['output_tokens']);
          const cacheRead = num(attrs['gen_ai.usage.cache_read_tokens'] ?? attrs['cache_read_tokens']);
          const cacheWrite = num(attrs['gen_ai.usage.cache_write_tokens'] ?? attrs['cache_write_tokens']);
          const reasoning = num(attrs['gen_ai.usage.reasoning_tokens'] ?? attrs['reasoning_tokens']);
          const content = String(attrs['gen_ai.prompt'] || attrs['prompt'] || '');
          const role: NormalizedMessage['role'] = isChat ? 'user' : 'assistant';
          const privacy = applyPrivacyContent(role, content, options);

          const message: NormalizedMessage = {
            id: record.span_id || newMessageId(),
            sessionId,
            role,
            model: model || undefined,
            ...privacy,
            inputTokens,
            outputTokens,
            cacheReadTokens: cacheRead,
            cacheCreationTokens: cacheWrite,
            reasoningTokens: reasoning,
            usageConfidence: inputTokens || outputTokens ? 'exact' : 'unavailable',
            metadata: {
              traceId: record.trace_id,
              spanName: record.name,
            },
            raw: shouldStoreRaw(options) ? record : undefined,
          };

          if (!sessions.has(sessionId)) sessions.set(sessionId, []);
          sessions.get(sessionId)!.push(message);
        },
        (lineNum, error) => warnings.push(jsonParseWarning(filePath, error, lineNum)),
      );
    } catch (error) {
      warnings.push(fileReadWarning(filePath, error));
      return { sessions: [], warnings };
    }

    if (sessions.size === 0) {
      return {
        sessions: [],
        warnings: [
          ...warnings,
          {
            file: filePath,
            message:
              'No Copilot OpenTelemetry spans found. Ensure COPILOT_OTEL_ENABLED=true and COPILOT_OTEL_EXPORTER_TYPE=file.',
            severity: 'warning',
            code: 'missing-token-fields',
          },
        ],
      };
    }

    const normalized = Array.from(sessions.entries()).map(([sessionId, msgs]) =>
      buildSession(sessionId, 'copilot', msgs, {
        sourcePath: filePath,
        storageKind: 'otel',
        supportLevel: 'exact-usage',
        usageConfidence: 'exact',
        projectPath: path.dirname(filePath),
      }),
    );

    return { sessions: normalized, warnings };
  },
};

function flattenOtel(record: OtelSpan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (record['attributes.model']) out.model = record['attributes.model'];
  return out;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
