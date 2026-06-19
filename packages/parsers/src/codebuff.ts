import fs from 'fs';
import path from 'path';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
import { applyPrivacyContent, buildSession, fileReadWarning, newMessageId, shouldStoreRaw } from './parser-helpers.js';

type CodebuffMessage = {
  role?: string;
  content?: string;
  metadata?: {
    usage?: Record<string, number>;
    codebuff?: { usage?: Record<string, number> };
    runState?: { providerUsage?: Record<string, number> };
  };
};

export const codebuffParser: ProviderParser = {
  provider: 'codebuff',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('chat-messages.json')) return false;
    try {
      const data = JSON.parse(sample);
      return Array.isArray(data) || Array.isArray((data as { messages?: unknown[] }).messages);
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const list: CodebuffMessage[] = Array.isArray(raw) ? raw : raw.messages || [];
      const chatDir = path.basename(path.dirname(filePath));
      const projectDir = path.basename(path.dirname(path.dirname(path.dirname(filePath))));
      const sessionId = chatDir;
      const messages: NormalizedMessage[] = [];

      for (const msg of list) {
        const role = msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'unknown';
        const usage = extractUsage(msg.metadata);
        const privacy = applyPrivacyContent(role, msg.content, options);
        messages.push({
          id: newMessageId(),
          sessionId,
          role,
          ...privacy,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheCreationTokens: usage.cacheCreation,
          cacheReadTokens: usage.cacheRead,
          usageConfidence: usage.input || usage.output ? 'exact' : 'metadata-only',
          metadata:
            usage.credits != null
              ? { credits: usage.credits }
              : options?.privacyMode === 'full' || options?.privacyMode === 'raw'
                ? msg.metadata
                : undefined,
          raw: shouldStoreRaw(options) ? msg : undefined,
        });
      }

      if (messages.length === 0) {
        return { sessions: [], warnings };
      }

      const hasUsage = messages.some((m) => m.inputTokens || m.outputTokens);

      return {
        sessions: [
          buildSession(sessionId, 'codebuff', messages, {
            sourcePath: filePath,
            storageKind: 'json',
            supportLevel: hasUsage ? 'exact-usage' : 'partial-usage',
            usageConfidence: hasUsage ? 'exact' : 'metadata-only',
            projectName: projectDir,
          }),
        ],
        warnings: hasUsage
          ? warnings
          : [
              ...warnings,
              {
                file: filePath,
                message: 'Codebuff messages found without usage metadata',
                severity: 'warning',
                code: 'missing-token-fields',
              },
            ],
      };
    } catch (error) {
      warnings.push(fileReadWarning(filePath, error));
      return { sessions: [], warnings };
    }
  },
};

function extractUsage(metadata?: CodebuffMessage['metadata']): {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
  credits?: number;
} {
  const sources = [
    metadata?.usage,
    metadata?.codebuff?.usage,
    metadata?.runState?.providerUsage,
  ].filter(Boolean) as Array<Record<string, number>>;

  const pick = (...keys: string[]) => {
    for (const src of sources) {
      for (const key of keys) {
        if (typeof src[key] === 'number') return src[key];
      }
    }
    return undefined;
  };

  return {
    input: pick('inputTokens', 'input_tokens', 'promptTokens', 'input'),
    output: pick('outputTokens', 'output_tokens', 'completionTokens', 'output'),
    cacheCreation: pick('cacheCreationTokens', 'cache_creation_tokens', 'cacheWrite'),
    cacheRead: pick('cacheReadTokens', 'cache_read_tokens', 'cachedInput'),
    credits: pick('credits'),
  };
}
