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
  newMessageId,
  shouldStoreRaw,
  streamJsonl,
} from './parser-helpers.js';

type DroidSettings = {
  sessionId?: string;
  sessionName?: string;
  projectName?: string;
  model?: string;
  provider?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    thinkingTokens?: number;
    reasoningTokens?: number;
  };
  messages?: Array<{
    role?: string;
    content?: string;
    model?: string;
    usage?: DroidSettings['usage'];
  }>;
};

export const droidParser: ProviderParser = {
  provider: 'droid',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('.factory')) return false;
    // Doc §8.232: Factory writes JSONL session logs; some builds also emit a
    // single `.settings.json`. Accept both.
    const isJsonl = filePath.endsWith('.jsonl');
    const isSettings = filePath.endsWith('.settings.json') || filePath.endsWith('.json');
    if (!isJsonl && !isSettings) return false;
    try {
      if (isJsonl) {
        const line = sample.split('\n').find((l) => l.trim());
        if (!line) return false;
        const r = JSON.parse(line) as DroidSettings;
        return r.usage !== undefined || Array.isArray(r.messages) || r.sessionId !== undefined;
      }
      const data = JSON.parse(sample) as DroidSettings;
      return (
        data.usage !== undefined || Array.isArray(data.messages) || data.sessionId !== undefined
      );
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const isJsonl = filePath.endsWith('.jsonl');
    try {
      const sessionId = isJsonl ? path.basename(filePath, '.jsonl') : undefined;
      const messages: NormalizedMessage[] = [];
      let sessionMeta: DroidSettings = {};

      const ingest = (data: DroidSettings) => {
        // First record carrying sessionId/projectName/model sets the session.
        if (!sessionMeta.sessionId && data.sessionId) sessionMeta = { ...sessionMeta, ...data };
        if (Array.isArray(data.messages)) {
          for (const msg of data.messages) {
            messages.push(
              buildDroidMessage(sessionMeta.sessionId || sessionId || 'droid', msg, data, options),
            );
          }
        } else if (data.usage) {
          messages.push(
            buildDroidMessage(
              sessionMeta.sessionId || sessionId || 'droid',
              { role: 'assistant', usage: data.usage },
              data,
              options,
            ),
          );
        }
      };

      if (isJsonl) {
        await streamJsonl<DroidSettings>(
          filePath,
          (record) => ingest(record),
          (lineNum, error) => warnings.push(jsonParseWarning(filePath, error, lineNum)),
        );
      } else {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DroidSettings;
        ingest(data);
      }

      const finalSessionId =
        sessionMeta.sessionId || sessionId || path.basename(filePath, '.settings.json');

      if (messages.length === 0) {
        return {
          sessions: [],
          warnings: [
            {
              file: filePath,
              message: 'No Factory Droid usage fields found',
              severity: 'warning',
              code: 'missing-token-fields',
            },
          ],
        };
      }

      const hasExact = messages.some((m) => m.inputTokens || m.outputTokens);

      return {
        sessions: [
          buildSession(finalSessionId, 'droid', messages, {
            sourcePath: filePath,
            storageKind: isJsonl ? 'jsonl' : 'json',
            supportLevel: hasExact ? 'exact-usage' : 'partial-usage',
            usageConfidence: hasExact ? 'exact' : 'unavailable',
            projectName: sessionMeta.projectName || sessionMeta.sessionName,
            metadata: sessionMeta.provider ? { provider: sessionMeta.provider } : undefined,
          }),
        ],
        warnings,
      };
    } catch (error) {
      warnings.push(fileReadWarning(filePath, error));
      return { sessions: [], warnings };
    }
  },
};

function buildDroidMessage(
  sessionId: string,
  msg: NonNullable<DroidSettings['messages']>[number],
  session: DroidSettings,
  options?: ParseOptions,
): NormalizedMessage {
  const role = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'unknown';
  const usage = msg.usage || session.usage || {};
  const privacy = applyPrivacyContent(role, msg.content, options);
  const reasoningTokens = usage.thinkingTokens ?? usage.reasoningTokens;
  return {
    id: newMessageId(),
    sessionId,
    role,
    model: msg.model || session.model,
    ...privacy,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    reasoningTokens,
    usageConfidence: usage.inputTokens || usage.outputTokens ? 'exact' : 'unavailable',
    raw: shouldStoreRaw(options) ? msg : undefined,
  };
}
