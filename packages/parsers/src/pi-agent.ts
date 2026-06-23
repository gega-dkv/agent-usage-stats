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

type PiResolvedProvider = 'claude' | 'codex';

/**
 * Real pi-agent session logs (`~/.pi/agent/sessions/*.jsonl`) mix Codex and
 * Claude turns. Each file is one session, but turns may be served by either
 * backend. scanner.md resolves which provider/model served each turn from:
 *  - `model_change` rows that set the current provider/model context
 *    (`openai-codex` -> codex, `anthropic` -> claude)
 *  - per-message `provider`/`model` fields that override the current context
 * Usage is read from a wide alias set (input/cacheRead/cacheWrite/output +
 * their snake/camel variants). We keep one pi-agent session but record the
 * resolved provider + model on each message's metadata so per-turn pricing can
 * be applied later.
 */
type PiUsage = Record<string, unknown>;

type PiAgentRecord = {
  sessionId?: string;
  id?: string;
  type?: string;
  role?: string;
  provider?: string;
  model?: string;
  modelId?: string;
  content?: string;
  timestamp?: string;
  message?: {
    role?: string;
    provider?: string;
    model?: string;
    modelId?: string;
    content?: string;
    timestamp?: string;
    usage?: PiUsage;
  };
  usage?: PiUsage;
  messages?: PiAgentRecord[];
};

export const piAgentParser: ProviderParser = {
  provider: 'pi-agent',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('.pi/agent')) return false;
    if (filePath.endsWith('.jsonl')) {
      try {
        const lines = sample.split('\n').filter((l) => l.trim());
        for (const line of lines.slice(0, 10)) {
          try {
            const r = JSON.parse(line) as PiAgentRecord;
            if (r.type === 'model_change' || r.type === 'message') return true;
            if (r.usage !== undefined || r.role !== undefined) return true;
            if (r.message && (r.message.usage !== undefined || r.message.role !== undefined)) return true;
          } catch {
            // keep scanning
          }
        }
        return false;
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

  // Current provider/model context, updated by `model_change` rows.
  let context: { provider: PiResolvedProvider; model: string } | null = null;

  try {
    await streamJsonl<PiAgentRecord>(
      filePath,
      (record) => {
        // model_change rows advance the current backend/model context.
        if (record.type === 'model_change') {
          const next = piModelContext(record);
          if (next) context = next;
          return;
        }

        // The assistant usage rows are `type:"message"` with a nested
        // `message.role === "assistant"`. Fall back to the simplified legacy
        // shape (typeless record with top-level role/usage) too.
        const message = record.message;
        const role = message?.role ?? record.role;
        const isAssistant = role === 'assistant';
        if (!isAssistant && record.type === 'message') return;

        const msg = toMessage(record, sessionId, context, options);
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
      // JSON fixtures carry no model_change context; resolve per-record only.
      const msg = toMessage(record, sessionId, null, options);
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
  fallbackContext: { provider: PiResolvedProvider; model: string } | null,
  options?: ParseOptions,
): NormalizedMessage | null {
  const message = record.message;
  const roleRaw = message?.role ?? record.role ?? 'unknown';
  const role = roleRaw === 'user' ? 'user' : roleRaw === 'assistant' ? 'assistant' : 'unknown';
  if (role === 'unknown' && !record.usage && !message?.usage && !record.content && !message?.content) {
    return null;
  }

  const identity = resolvePiAssistantIdentity(record, fallbackContext);
  const usageSource = message?.usage ?? record.usage ?? {};
  const usage = extractPiUsage(usageSource);

  const contentText = message?.content ?? record.content;
  const privacy = applyPrivacyContent(role, contentText ?? undefined, options);

  const metadata: Record<string, unknown> | undefined =
    identity && (identity.provider || identity.model)
      ? {
          ...(identity.provider ? { resolvedProvider: identity.provider } : {}),
          ...(identity.model ? { resolvedModel: identity.model } : {}),
        }
      : undefined;

  const hasUsage =
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0;

  return {
    id: record.id || message?.timestamp || newMessageId(),
    sessionId,
    timestamp: message?.timestamp ?? record.timestamp,
    role,
    model: identity?.model ?? message?.model ?? record.model,
    ...privacy,
    inputTokens: usage.input || undefined,
    outputTokens: usage.output || undefined,
    cacheCreationTokens: usage.cacheWrite || undefined,
    cacheReadTokens: usage.cacheRead || undefined,
    cachedInputTokens:
      usage.cacheRead || usage.cacheWrite
        ? (usage.cacheRead || 0) + (usage.cacheWrite || 0)
        : undefined,
    metadata,
    usageConfidence: hasUsage ? 'exact' : 'metadata-only',
    raw: shouldStoreRaw(options) ? record : undefined,
  };
}

/**
 * Resolve the backend provider + model that served a turn. Ports
 * resolvePiAssistantIdentity from scanner.md: prefer an explicit per-message
 * provider/model, then the current model_change context as a fallback.
 */
function resolvePiAssistantIdentity(
  record: PiAgentRecord,
  fallback: { provider: PiResolvedProvider; model: string } | null,
): { provider: PiResolvedProvider; model: string } | null {
  const message = record.message;
  const explicitProviderText = extractPiProviderText(record, message);
  const explicitProvider = explicitProviderText ? mapPiProvider(explicitProviderText) : null;
  const explicitModelText = extractPiModelText(record, message);

  // An explicit but unrecognized provider means we cannot classify the turn.
  if (explicitProviderText && !explicitProvider) return null;

  if (explicitProvider && explicitModelText) {
    const model = normalizePiModel(explicitModelText, explicitProvider);
    if (model) return { provider: explicitProvider, model };
  }

  if (explicitProvider && fallback && fallback.provider === explicitProvider) {
    return { provider: explicitProvider, model: fallback.model };
  }

  if (!explicitProviderText && explicitModelText && fallback) {
    const model = normalizePiModel(explicitModelText, fallback.provider);
    if (model) return { provider: fallback.provider, model };
  }

  if (!explicitProviderText && fallback) {
    return fallback;
  }

  // No provider context at all. If there is still a model string, we cannot
  // know which pricing table applies, so leave resolution to the caller (model
  // is still attached to the message without a resolvedProvider).
  return null;
}

/** Read a model_change row's provider/model into a context. Ports piModelContext. */
function piModelContext(record: PiAgentRecord): { provider: PiResolvedProvider; model: string } | null {
  const provider = mapPiProvider(record.provider);
  if (!provider) return null;
  const rawModel = String(record.modelId ?? record.model ?? '').trim();
  const model = normalizePiModel(rawModel, provider);
  if (!model) return null;
  return { provider, model };
}

function extractPiProviderText(
  record: PiAgentRecord,
  message: PiAgentRecord['message'],
): string | null {
  for (const src of [message?.provider, record.provider]) {
    const s = String(src ?? '').trim();
    if (s.length) return s;
  }
  return null;
}

function extractPiModelText(
  record: PiAgentRecord,
  message: PiAgentRecord['message'],
): string | null {
  for (const value of [message?.model, record.model, message?.modelId, record.modelId]) {
    const s = String(value ?? '').trim();
    if (s.length) return s;
  }
  return null;
}

/** Map pi's provider labels onto the two backends it proxies. */
function mapPiProvider(provider: string | undefined): PiResolvedProvider | null {
  switch (provider?.toLowerCase()) {
    case 'openai-codex':
      return 'codex';
    case 'anthropic':
      return 'claude';
    default:
      return null;
  }
}

/**
 * Light model normalization for metadata. The full codex/claude normalization
 * lives in the pricing layer; here we only strip obvious prefixes so the stored
 * resolvedModel is stable.
 */
function normalizePiModel(raw: string, provider: PiResolvedProvider): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (provider === 'codex' && trimmed.startsWith('openai/')) {
    return trimmed.slice('openai/'.length);
  }
  if (provider === 'claude' && trimmed.startsWith('anthropic.')) {
    return trimmed.slice('anthropic.'.length);
  }
  return trimmed;
}

/** Read the wide alias set pi-agent usage blocks use. Ports extractPiUsage. */
function extractPiUsage(usage: PiUsage): {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
} {
  return {
    input: readPiNonNegativeInt(
      usage.input ?? usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens,
    ),
    cacheRead: readPiNonNegativeInt(
      usage.cacheRead ??
        usage.cacheReadTokens ??
        usage.cache_read ??
        usage.cache_read_tokens ??
        usage.cacheReadInputTokens ??
        usage.cache_read_input_tokens,
    ),
    cacheWrite: readPiNonNegativeInt(
      usage.cacheWrite ??
        usage.cacheWriteTokens ??
        usage.cache_write ??
        usage.cache_write_tokens ??
        usage.cacheCreationTokens ??
        usage.cache_creation_tokens ??
        usage.cacheCreationInputTokens ??
        usage.cache_creation_input_tokens,
    ),
    output: readPiNonNegativeInt(
      usage.output ?? usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens,
    ),
  };
}

function readPiNonNegativeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return 0;
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
