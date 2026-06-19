import fs from 'fs';
import path from 'path';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
import { applyPrivacyContent, buildSession, fileReadWarning, newMessageId, shouldStoreRaw } from './parser-helpers.js';

type AmpThread = {
  id?: string;
  title?: string;
  model?: string;
  provider?: string;
  messages?: Array<{
    role?: string;
    content?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    credits?: number;
  }>;
  usageLedger?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_tokens?: number;
    cache_read_tokens?: number;
    credits?: number;
  };
};

export const ampParser: ProviderParser = {
  provider: 'amp',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('/amp/') && !filePath.includes('.local/share/amp')) return false;
    if (!filePath.endsWith('.json')) return false;
    try {
      const data = JSON.parse(sample) as AmpThread;
      return data.usageLedger !== undefined || Array.isArray(data.messages);
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AmpThread;
      const sessionId = data.id || path.basename(filePath, '.json');
      const messages: NormalizedMessage[] = [];
      const ledger = data.usageLedger;

      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          const role = mapRole(msg.role);
          const usage = msg.usage || {};
          const privacy = applyPrivacyContent(role, msg.content, options);
          const model = normalizeModel(msg.model || data.model);
          messages.push({
            id: newMessageId(),
            sessionId,
            role,
            model,
            ...privacy,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheCreationTokens: usage.cache_creation_input_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            usageConfidence: usage.input_tokens || usage.output_tokens ? 'exact' : 'unavailable',
            metadata: msg.credits ? { credits: msg.credits } : undefined,
            raw: shouldStoreRaw(options) ? msg : undefined,
          });
        }
      } else if (ledger) {
        messages.push({
          id: newMessageId(),
          sessionId,
          role: 'assistant',
          model: normalizeModel(data.model),
          contentPreview: '[session usage ledger]',
          contentHidden: true,
          inputTokens: ledger.input_tokens,
          outputTokens: ledger.output_tokens,
          cacheCreationTokens: ledger.cache_creation_tokens,
          cacheReadTokens: ledger.cache_read_tokens,
          usageConfidence: 'exact',
          metadata: ledger.credits ? { credits: ledger.credits } : undefined,
        });
      }

      if (messages.length === 0) {
        return {
          sessions: [],
          warnings: [
            {
              file: filePath,
              message: 'No Amp usage data found',
              severity: 'warning',
              code: 'missing-token-fields',
            },
          ],
        };
      }

      return {
        sessions: [
          buildSession(sessionId, 'amp', messages, {
            sourcePath: filePath,
            storageKind: 'json',
            supportLevel: 'exact-usage',
            usageConfidence: 'exact',
            projectPath: path.dirname(filePath),
            metadata: data.provider ? { provider: data.provider, title: data.title } : { title: data.title },
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

function mapRole(role?: string): NormalizedMessage['role'] {
  switch ((role || '').toLowerCase()) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    default:
      return 'unknown';
  }
}

function normalizeModel(model?: string): string | undefined {
  if (!model) return undefined;
  return model.includes('/') ? model.split('/').pop() : model;
}
