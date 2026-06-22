import fs from 'fs';
import readline from 'readline';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedSession,
  NormalizedMessage,
} from '@agent-usage/shared';
import {
  generateId,
  truncateText,
  estimateTokensFromText,
  totalsFromMessages,
} from '@agent-usage/shared';
import {
  buildSession,
  normalizeSessionIdFromPath,
  shouldStoreRaw,
} from './parser-helpers.js';

type LegacyCodexMessage = {
  role?: string;
  content?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  timestamp?: string;
  session_id?: string;
  type?: string;
  name?: string;
  arguments?: string;
  tool_call_id?: string;
};

type CodexTokenUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

type CodexEvent = {
  timestamp?: string;
  type: string;
  payload?: unknown;
};

export const codexParser: ProviderParser = {
  provider: 'codex',

  canParse(_filePath: string, sample: string): boolean {
    try {
      const trimmed = sample.trim();
      if (!trimmed) return false;

      // Event-format files can have a huge first line; detect by markers first.
      if (
        trimmed.includes('"type":"session_meta"') ||
        trimmed.includes('"type":"token_count"') ||
        trimmed.includes('"type":"turn_context"') ||
        trimmed.includes('"type":"response_item"')
      ) {
        return true;
      }

      // Try as single JSON object
      if (trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed);
          if (typeof data === 'object' && data !== null) {
            // Event-format object (small files only)
            if ('type' in data && 'payload' in data) return true;
            // Legacy object with a messages/conversation/history/session array
            const arr =
              Array.isArray(data.messages) ? data.messages :
              Array.isArray(data.conversation) ? data.conversation :
              Array.isArray(data.history) ? data.history :
              Array.isArray(data.session) ? data.session :
              undefined;
            if (arr && arr.some(looksLikeLegacyCodexMessage)) return true;
            // Single legacy message record
            if (looksLikeLegacyCodexMessage(data)) return true;
          }
        } catch {
          // Not valid JSON, try JSONL heuristics below
        }
      }

      // Try as array JSON
      if (trimmed.startsWith('[')) {
        try {
          const data = JSON.parse(trimmed);
          if (Array.isArray(data) && data.length > 0) {
            return data.some(looksLikeLegacyCodexMessage);
          }
        } catch {
          // Not valid
        }
      }

      // Try JSONL
      const lines = trimmed.split('\n').filter(Boolean).slice(0, 10);
      for (const line of lines) {
        if (
          line.includes('"type":"session_meta"') ||
          line.includes('"type":"token_count"') ||
          line.includes('"type":"turn_context"') ||
          line.includes('"type":"response_item"')
        ) {
          return true;
        }
        try {
          const r = JSON.parse(line);
          if (looksLikeLegacyCodexMessage(r)) return true;
        } catch {
          // skip
        }
      }
      return false;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const sessions = new Map<string, NormalizedSession>();
    const warnings: ParseResult['warnings'] = [];

    try {
      const format = detectCodexFormat(filePath);

      if (format === 'events-jsonl') {
        const result = await parseCodexEventsJsonl(filePath, options);
        for (const session of result.sessions) {
          sessions.set(session.id, session);
        }
        warnings.push(...result.warnings);
      } else if (format === 'json') {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content);
        const result = parseCodexJson(data, filePath, options);
        for (const session of result.sessions) {
          sessions.set(session.id, session);
        }
        warnings.push(...result.warnings);
      } else {
        const result = await parseCodexJsonl(filePath, options);
        for (const session of result.sessions) {
          sessions.set(session.id, session);
        }
        warnings.push(...result.warnings);
      }
    } catch (e) {
      warnings.push({
        file: filePath,
        message: `Failed to parse Codex file: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
        code: 'json-parse-error',
      });
    }

    return { sessions: Array.from(sessions.values()), warnings };
  },
};

function detectCodexFormat(
  filePath: string,
): 'json' | 'jsonl' | 'events-jsonl' {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    const sample = buf.slice(0, bytesRead).toString('utf-8');
    if (sample.trim().startsWith('[')) return 'json';
    // Event-format files often have a huge first line; detect by markers.
    if (
      sample.includes('"type":"session_meta"') ||
      sample.includes('"type":"token_count"') ||
      sample.includes('"type":"turn_context"') ||
      sample.includes('"type":"response_item"')
    ) {
      return 'events-jsonl';
    }
    if (sample.trim().startsWith('{')) {
      const firstLine = sample.split('\n')[0] || sample;
      try {
        const first = JSON.parse(firstLine);
        if (
          typeof first === 'object' &&
          first !== null &&
          'type' in first &&
          'payload' in first
        ) {
          return 'events-jsonl';
        }
        if (
          Array.isArray(first.messages) ||
          Array.isArray(first.conversation) ||
          Array.isArray(first.history) ||
          Array.isArray(first.session)
        ) {
          return 'json';
        }
      } catch {
        // fall through to jsonl
      }
    }
    return 'jsonl';
  } finally {
    fs.closeSync(fd);
  }
}

function parseCodexJson(
  data: unknown,
  filePath: string,
  options?: ParseOptions,
): ParseResult {
  const sessions: NormalizedSession[] = [];
  const warnings: ParseResult['warnings'] = [];

  // Handle various Codex formats
  let messages: LegacyCodexMessage[] = [];

  if (Array.isArray(data)) {
    messages = data;
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.messages)) messages = obj.messages as LegacyCodexMessage[];
    else if (Array.isArray(obj.conversation)) messages = obj.conversation as LegacyCodexMessage[];
    else if (Array.isArray(obj.history)) messages = obj.history as LegacyCodexMessage[];
    else if (Array.isArray(obj.session)) messages = obj.session as LegacyCodexMessage[];
  }

  if (messages.length === 0) return { sessions: [], warnings: [] };

  const sessionId =
    (messages[0] as LegacyCodexMessage)?.session_id || generateId();
  const normalizedMessages: NormalizedMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const normalized = normalizeCodexMessage(msg, sessionId, options);
    normalizedMessages.push(normalized);
  }

  const totals = totalsFromMessages(normalizedMessages);
  const firstMsg = normalizedMessages[0];
  const lastMsg = normalizedMessages[normalizedMessages.length - 1];

  sessions.push({
    id: sessionId,
    provider: 'codex',
    sourcePath: filePath,
    projectPath: path.dirname(filePath),
    projectName: path.basename(path.dirname(filePath)),
    startedAt: firstMsg?.timestamp,
    updatedAt: lastMsg?.timestamp,
    messages: normalizedMessages,
    totals,
  });

  return { sessions, warnings };
}

async function parseCodexJsonl(
  filePath: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const sessions = new Map<string, NormalizedSession>();
  const warnings: ParseResult['warnings'] = [];
  const messagesBySession = new Map<string, NormalizedMessage[]>();

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentSessionId = '';
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    try {
      const record: LegacyCodexMessage = JSON.parse(line);

      if (record.session_id) currentSessionId = record.session_id;
      else if (!currentSessionId) currentSessionId = path.basename(filePath);

      if (!messagesBySession.has(currentSessionId)) {
        messagesBySession.set(currentSessionId, []);
      }

      const normalized = normalizeCodexMessage(record, currentSessionId, options);
      messagesBySession.get(currentSessionId)!.push(normalized);
    } catch (e) {
      warnings.push({
        file: filePath,
        line: lineNum,
        message: `Failed to parse line: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'warning',
        code: 'json-parse-error',
      });
    }
  }

  for (const [sessionId, messages] of messagesBySession) {
    const totals = totalsFromMessages(messages);
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    sessions.set(sessionId, {
      id: sessionId,
      provider: 'codex',
      sourcePath: filePath,
      projectPath: path.dirname(filePath),
      projectName: path.basename(path.dirname(filePath)),
      startedAt: firstMsg?.timestamp,
      updatedAt: lastMsg?.timestamp,
      messages,
      totals,
    });
  }

  return { sessions: Array.from(sessions.values()), warnings };
}

async function parseCodexEventsJsonl(
  filePath: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const warnings: ParseResult['warnings'] = [];

  let sessionId = '';
  let startedAt: string | undefined;
  let lastTimestamp: string | undefined;
  let model: string | undefined;
  const tokenUsages: CodexTokenUsage[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    try {
      const record: CodexEvent = JSON.parse(line);
      if (record.timestamp) lastTimestamp = record.timestamp;

      if (record.type === 'session_meta' && isObject(record.payload)) {
        const p = record.payload;
        if (typeof p.id === 'string') sessionId = p.id;
        if (typeof p.timestamp === 'string') startedAt = p.timestamp;
      } else if (record.type === 'turn_context' && isObject(record.payload)) {
        const p = record.payload;
        if (typeof p.model === 'string') model = p.model;
      } else if (record.type === 'event_msg' && isObject(record.payload)) {
        const p = record.payload;
        if (
          p.type === 'token_count' &&
          isObject(p.info) &&
          isObject(p.info.total_token_usage)
        ) {
          tokenUsages.push(p.info.total_token_usage as CodexTokenUsage);
        }
      }
    } catch (e) {
      warnings.push({
        file: filePath,
        line: lineNum,
        message: `Failed to parse line: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'warning',
        code: 'json-parse-error',
      });
    }
  }

  if (!sessionId) {
    sessionId = normalizeSessionIdFromPath(filePath);
  }

  if (tokenUsages.length === 0) {
    warnings.push({
      file: filePath,
      message: 'No token_count events found in Codex session',
      severity: 'warning',
      code: 'missing-token-fields',
    });
  }

  const finalUsage = tokenUsages[tokenUsages.length - 1];
  const hasExactUsage = !!finalUsage;

  const inputTotal = finalUsage?.input_tokens ?? 0;
  const cachedInput = finalUsage?.cached_input_tokens ?? 0;
  // OpenAI reports input_tokens inclusive of cached tokens. For cost calculation
  // we want the non-cached portion charged at the input rate and cached portion
  // charged at the discounted cached rate.
  const inputTokens =
    cachedInput > 0 && inputTotal > cachedInput
      ? inputTotal - cachedInput
      : inputTotal;

  const usageMessage: NormalizedMessage = {
    id: generateId(),
    sessionId,
    timestamp: lastTimestamp ?? startedAt,
    role: 'assistant',
    model,
    contentPreview: '[token usage]',
    inputTokens: inputTokens || undefined,
    outputTokens: finalUsage?.output_tokens || undefined,
    cachedInputTokens: cachedInput || undefined,
    cacheReadTokens: cachedInput || undefined,
    reasoningTokens: finalUsage?.reasoning_output_tokens || undefined,
    usageConfidence: hasExactUsage ? 'exact' : 'estimated-from-text',
    raw: shouldStoreRaw(options) && finalUsage ? finalUsage : undefined,
  };

  const session = buildSession(sessionId, 'codex', [usageMessage], {
    sourcePath: filePath,
    projectPath: path.dirname(filePath),
    projectName: path.basename(path.dirname(filePath)),
    startedAt,
    updatedAt: lastTimestamp ?? startedAt,
    supportLevel: hasExactUsage ? 'exact-usage' : 'partial-usage',
    usageConfidence: hasExactUsage ? 'exact' : 'estimated-from-text',
    tokenUsageEstimated: !hasExactUsage,
  });

  // Codex's reported total_tokens is authoritative (it may not equal the sum of
  // input/cached/output/reasoning depending on how the CLI counts them).
  if (finalUsage && finalUsage.total_tokens != null) {
    session.totals.totalTokens = finalUsage.total_tokens;
  }

  return { sessions: [session], warnings };
}

function normalizeCodexMessage(
  msg: LegacyCodexMessage,
  sessionId: string,
  options?: ParseOptions,
): NormalizedMessage {
  const role = mapCodexRole(msg.role || msg.type || 'unknown');
  const contentText = msg.content || '';
  const contentPreview = truncateText(contentText, 200);

  const usage = msg.usage || {};
  const inputTokens = usage.prompt_tokens || undefined;
  const outputTokens = usage.completion_tokens || undefined;

  let estInput = inputTokens;
  let estOutput = outputTokens;
  if (!estInput && role === 'user') estInput = estimateTokensFromText(contentText);
  if (!estOutput && role === 'assistant') estOutput = estimateTokensFromText(contentText);

  return {
    id: generateId(),
    sessionId,
    timestamp: msg.timestamp,
    role,
    model: msg.model,
    contentText: options?.privacyMode === 'disabled' ? undefined : contentText,
    contentPreview:
      options?.privacyMode === 'disabled' ? `[${role} message]` : contentPreview,
    inputTokens: estInput,
    outputTokens: estOutput,
    toolName: msg.name,
    toolInputPreview:
      options?.privacyMode === 'disabled'
        ? undefined
        : msg.arguments
          ? truncateText(msg.arguments, 200)
          : undefined,
    raw: shouldStoreRaw(options) ? msg : undefined,
  };
}

function mapCodexRole(role: string): NormalizedMessage['role'] {
  switch (role.toLowerCase()) {
    case 'user':
    case 'human':
      return 'user';
    case 'assistant':
    case 'ai':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
    case 'function':
      return 'tool';
    default:
      return 'unknown';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function looksLikeLegacyCodexMessage(value: unknown): boolean {
  if (!isObject(value)) return false;
  const hasRoleAndContent =
    typeof value.role === 'string' &&
    ['user', 'assistant', 'system', 'tool'].includes(value.role) &&
    typeof value.content === 'string';
  const hasUsage =
    isObject(value.usage) &&
    (typeof value.usage.prompt_tokens === 'number' ||
      typeof value.usage.completion_tokens === 'number');
  const hasSessionId = typeof value.session_id === 'string';
  return hasRoleAndContent || hasUsage || hasSessionId;
}
