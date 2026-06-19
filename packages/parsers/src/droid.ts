import fs from 'fs';
import path from 'path';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
import { applyPrivacyContent, buildSession, fileReadWarning, newMessageId, shouldStoreRaw } from './parser-helpers.js';

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
    if (!filePath.includes('.factory') || !filePath.endsWith('.settings.json')) return false;
    try {
      const data = JSON.parse(sample) as DroidSettings;
      return data.usage !== undefined || Array.isArray(data.messages) || data.sessionId !== undefined;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DroidSettings;
      const sessionId = data.sessionId || path.basename(filePath, '.settings.json');
      const messages: NormalizedMessage[] = [];

      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          messages.push(buildDroidMessage(sessionId, msg, data, options));
        }
      } else if (data.usage) {
        messages.push(buildDroidMessage(sessionId, { role: 'assistant', usage: data.usage }, data, options));
      }

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
          buildSession(sessionId, 'droid', messages, {
            sourcePath: filePath,
            storageKind: 'json',
            supportLevel: hasExact ? 'exact-usage' : 'partial-usage',
            usageConfidence: hasExact ? 'exact' : 'unavailable',
            projectName: data.projectName || data.sessionName,
            metadata: data.provider ? { provider: data.provider } : undefined,
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
