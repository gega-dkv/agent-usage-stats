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
    // Doc §8.237: Amp emits JSONL (VERIFY); some builds use whole-file JSON.
    const isJsonl = filePath.endsWith('.jsonl');
    const isJson = filePath.endsWith('.json');
    if (!isJsonl && !isJson) return false;
    try {
      if (isJsonl) {
        const line = sample.split('\n').find((l) => l.trim());
        if (!line) return false;
        const r = JSON.parse(line) as Partial<AmpThread>;
        return r.usageLedger !== undefined || Array.isArray(r.messages) || r.id !== undefined;
      }
      const data = JSON.parse(sample) as AmpThread;
      return data.usageLedger !== undefined || Array.isArray(data.messages);
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    const isJsonl = filePath.endsWith('.jsonl');
    const fallbackSessionId = path.basename(filePath, isJsonl ? '.jsonl' : '.json');
    const messages: NormalizedMessage[] = [];
    let sessionId = fallbackSessionId;
    let meta: { provider?: string; title?: string } = {};

    const ingest = (data: AmpThread) => {
      if (data.id && sessionId === fallbackSessionId) sessionId = data.id;
      if (data.provider) meta.provider = data.provider;
      if (data.title) meta.title = data.title;
      const sessionLedger = data.usageLedger;
      const sessionModel = normalizeModel(data.model);

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
      }
      if (sessionLedger) {
        messages.push({
          id: newMessageId(),
          sessionId,
          role: 'assistant',
          model: sessionModel,
          contentPreview: '[session usage ledger]',
          contentHidden: true,
          inputTokens: sessionLedger.input_tokens,
          outputTokens: sessionLedger.output_tokens,
          cacheCreationTokens: sessionLedger.cache_creation_tokens,
          cacheReadTokens: sessionLedger.cache_read_tokens,
          usageConfidence: 'exact',
          metadata: sessionLedger.credits ? { credits: sessionLedger.credits } : undefined,
        });
      }
    };

    try {
      if (isJsonl) {
        await streamJsonl<AmpThread>(
          filePath,
          (record) => ingest(record),
          (lineNum, error) => warnings.push(jsonParseWarning(filePath, error, lineNum)),
        );
      } else {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AmpThread;
        ingest(data);
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
            storageKind: isJsonl ? 'jsonl' : 'json',
            supportLevel: 'exact-usage',
            usageConfidence: 'exact',
            projectPath: path.dirname(filePath),
            metadata: meta.provider
              ? { provider: meta.provider, title: meta.title }
              : { title: meta.title },
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
