import fs from 'fs';
import readline from 'readline';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParserOptions,
  NormalizedSession,
  NormalizedMessage,
} from '@agent-usage/shared';
import { generateId, truncateText, totalsFromMessages } from '@agent-usage/shared';
import { shouldStoreRaw, normalizeSessionIdFromPath } from './parser-helpers.js';

/**
 * Gemini CLI stores chats under `~/.gemini/tmp/<project_hash>/chats/` in two
 * shapes (see docs/ai-cli-token-parsers.md §5):
 *
 *  - `session-*.json`  — a whole-file snapshot: `{ sessionId, startTime,
 *    lastUpdated, messages:[...] }`.
 *  - `session-*.jsonl` — an append-only event log: line 0 is the session
 *    header (`kind:"main"`), then full message records interleaved with
 *    `{$set:{...}}` partial patches. A streaming message is appended more
 *    than once, so dedup by message `id` (keep the last = final tokens).
 *
 * Each message is `{ id, timestamp, type, content, model, tokens }` where
 * `type` is `user` / `gemini` (model) / `info` and `tokens` is
 * `{ input, output, cached, thoughts, tool, total }`. Gemini's `input`
 * INCLUDES the cached portion (§2/§5), so we store `inputTokens = input −
 * cached` and put `cached` in `cacheReadTokens`.
 *
 * A legacy/SDK fallback path also handles the raw API response shape
 * (`role:"model"`, `parts`, `usageMetadata.{promptTokenCount,...}`).
 */
type GeminiCliTokens = {
  input?: number;
  output?: number;
  cached?: number;
  thoughts?: number;
  tool?: number;
  total?: number;
};

// Real Gemini CLI message record.
type GeminiCliMessage = {
  id?: string;
  timestamp?: string;
  type?: string; // 'user' | 'gemini' | 'info' | ...
  content?: string | Array<{ text?: string }>;
  displayContent?: string;
  model?: string;
  tokens?: GeminiCliTokens;
  thoughts?: unknown;
  toolCalls?: unknown;
};

// Legacy raw API-response message shape (SDK / older fixtures).
type GeminiApiMessage = {
  role?: string;
  parts?: Array<{ text?: string; inlineData?: unknown }>;
  model?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
  createTime?: string;
  lastUpdateTime?: string;
};

type GeminiSnapshot = {
  sessionId?: string;
  chatId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  createTime?: string;
  lastUpdateTime?: string;
  messages?: GeminiCliMessage[];
};

type AnyMessage = GeminiCliMessage & GeminiApiMessage;

export const geminiParser: ProviderParser = {
  provider: 'gemini',

  canParse(filePath: string, sample: string): boolean {
    const lower = filePath.toLowerCase();
    const inGeminiTree = lower.includes('.gemini') || lower.includes('gemini');
    const trimmed = sample.trim();
    if (!trimmed) return false;

    // JSONL event log: real CLI sessions start with a header line carrying
    // sessionId/projectHash/kind, or contain typed message records.
    if (filePath.endsWith('.jsonl')) {
      const firstLine = trimmed.split('\n')[0] || '';
      try {
        const head = JSON.parse(firstLine);
        if (
          head &&
          typeof head === 'object' &&
          (('sessionId' in head && 'projectHash' in head) || 'kind' in head || '$set' in head)
        ) {
          return inGeminiTree;
        }
      } catch {
        // fall through to content sniff across lines
      }
      return inGeminiTree && sample.includes('"tokens"') && sample.includes('"type"');
    }

    // Whole-file JSON. IMPORTANT: the scanner may pass a truncated sample
    // (first 4 KB) of a multi-MB snapshot, so we must NOT require a full
    // JSON.parse here — sniff the leading text instead, and only fall back to
    // a parse for small/legacy shapes that fit in the sample.
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;

    // Real CLI snapshot: leading keys are sessionId/projectHash/startTime.
    if (
      inGeminiTree &&
      trimmed.startsWith('{') &&
      (sample.includes('"sessionId"') ||
        sample.includes('"projectHash"') ||
        sample.includes('"startTime"'))
    ) {
      return true;
    }
    // Legacy snapshot keyed by chatId / usageMetadata.
    if (inGeminiTree && sample.includes('"chatId"')) return true;

    // Try a full parse for small legacy samples (API-response arrays/objects).
    try {
      const data = JSON.parse(trimmed);
      const arr = Array.isArray(data)
        ? data
        : Array.isArray((data as { messages?: unknown[] }).messages)
          ? (data as { messages: unknown[] }).messages
          : [];
      if (arr.length > 0) {
        return arr.some(
          (m: any) =>
            m?.usageMetadata !== undefined ||
            m?.tokens !== undefined ||
            m?.parts !== undefined ||
            m?.role === 'model' ||
            m?.type === 'gemini' ||
            m?.role === 'user',
        );
      }
      if (!Array.isArray(data) && typeof data === 'object') {
        return (
          (data as { usageMetadata?: unknown }).usageMetadata !== undefined ||
          (Array.isArray((data as { parts?: unknown }).parts) &&
            (data as { role?: string }).role !== undefined)
        );
      }
    } catch {
      // Truncated/unparseable sample — rely on the substring sniffs above.
    }
    return false;
  },

  async parse(filePath: string, options?: ParserOptions): Promise<ParseResult> {
    if (filePath.endsWith('.jsonl')) return parseJsonlEventLog(filePath, options);
    return parseJsonSnapshot(filePath, options);
  },
};

/** Whole-file `.json` snapshot (the primary, auto-saved CLI format). */
function parseJsonSnapshot(filePath: string, options?: ParserOptions): ParseResult {
  const sessions: NormalizedSession[] = [];
  const warnings: ParseResult['warnings'] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as GeminiSnapshot | AnyMessage[];

    // A bare array is the legacy API-response shape (one message per entry).
    if (Array.isArray(data)) {
      const messages = data as AnyMessage[];
      if (messages.length === 0) return { sessions: [], warnings };
      const sessionId = generateId();
      const normalized = messages
        .map((m) => normalizeAnyMessage(m, sessionId, options))
        .filter((m): m is NormalizedMessage => m != null);
      sessions.push(buildSession(sessionId, normalized, filePath, undefined, undefined, undefined));
      return { sessions, warnings };
    }

    const messages: AnyMessage[] = (data.messages as AnyMessage[]) || [];
    if (messages.length === 0) return { sessions: [], warnings };

    const sessionId = data.sessionId || data.chatId || generateId();
    const normalized = messages
      .map((m) => normalizeAnyMessage(m, sessionId, options))
      .filter((m): m is NormalizedMessage => m != null);

    sessions.push(
      buildSession(
        sessionId,
        normalized,
        filePath,
        data.startTime || data.createTime,
        data.lastUpdated || data.lastUpdateTime,
        data.projectHash,
      ),
    );
  } catch (e) {
    warnings.push({
      file: filePath,
      message: `Failed to parse Gemini file: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'error',
      code: 'json-parse-error',
    });
  }

  return { sessions, warnings };
}

/**
 * Append-only `.jsonl` event log. Line 0 is the session header; subsequent
 * lines are full message records and `{$set}` patches. Messages repeat as they
 * stream, so we dedup by `id` keeping the last (final) occurrence's tokens.
 */
async function parseJsonlEventLog(filePath: string, options?: ParserOptions): Promise<ParseResult> {
  const sessions: NormalizedSession[] = [];
  const warnings: ParseResult['warnings'] = [];
  let sessionId = '';
  let startedAt: string | undefined;
  let lastUpdated: string | undefined;
  let projectHash: string | undefined;
  // id -> normalized message (last write wins for streaming updates).
  const byId = new Map<string, NormalizedMessage>();
  // Preserve first-seen order for ids that have no stable timestamp.
  const order: string[] = [];

  const applyPatch = (patch: Record<string, unknown>) => {
    if (typeof patch.lastUpdated === 'string') lastUpdated = patch.lastUpdated;
    if (typeof patch.startTime === 'string' && !startedAt) startedAt = patch.startTime;
  };

  try {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    let lineNum = 0;

    for await (const line of rl) {
      lineNum++;
      if (!line.trim()) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch (e) {
        warnings.push({
          file: filePath,
          line: lineNum,
          message: `Failed to parse line: ${e instanceof Error ? e.message : String(e)}`,
          severity: 'warning',
          code: 'json-parse-error',
        });
        continue;
      }

      // Session header line.
      if (typeof record.sessionId === 'string' && !sessionId) sessionId = record.sessionId;
      if (typeof record.projectHash === 'string' && !projectHash) projectHash = record.projectHash;
      if (typeof record.startTime === 'string' && !startedAt) startedAt = record.startTime;
      if (typeof record.lastUpdated === 'string') lastUpdated = record.lastUpdated;

      // Partial patch line — apply to session metadata, no message change.
      if (record.$set && typeof record.$set === 'object') {
        applyPatch(record.$set as Record<string, unknown>);
        continue;
      }

      // Message record.
      const id = typeof record.id === 'string' ? record.id : undefined;
      if (!id) continue;
      const msg = normalizeAnyMessage(record as AnyMessage, sessionId, options);
      if (!msg) continue;
      if (!byId.has(id)) order.push(id);
      byId.set(id, msg);
    }
  } catch (e) {
    warnings.push({
      file: filePath,
      message: `Failed to read Gemini file: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'error',
      code: 'missing-file',
    });
    return { sessions, warnings };
  }

  if (!sessionId) sessionId = normalizeSessionIdFromPath(filePath);
  const messages = order
    .map((id) => byId.get(id)!)
    .filter((m): m is NormalizedMessage => m != null);

  if (messages.length === 0) {
    warnings.push({
      file: filePath,
      message: 'No Gemini message records found in session log',
      severity: 'warning',
      code: 'missing-token-fields',
    });
    return { sessions, warnings };
  }

  sessions.push(buildSession(sessionId, messages, filePath, startedAt, lastUpdated, projectHash));
  return { sessions, warnings };
}

/**
 * Normalize a single message, supporting both the real CLI shape (`type`,
 * `tokens`, `content`) and the legacy API-response shape (`role`, `parts`,
 * `usageMetadata`). Returns null for non-conversational rows (e.g. `info`).
 */
function normalizeAnyMessage(
  msg: AnyMessage,
  sessionId: string,
  options?: ParserOptions,
): NormalizedMessage | null {
  const role = resolveRole(msg);
  // `info` rows are local-only banners (e.g. "Update successful!") with no
  // model turn or usage — skip them so they don't pollute totals.
  if (role === 'system') {
    return null;
  }

  const contentText = extractContentText(msg);
  const contentPreview = truncateText(contentText || '', 200);
  const model = msg.model;

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let reasoningTokens: number | undefined;
  let cachedInputTokens: number | undefined;

  if (msg.tokens) {
    // Real CLI token block: input INCLUDES cached (§2/§5) → split it.
    const cached = msg.tokens.cached;
    const rawInput = msg.tokens.input;
    inputTokens =
      rawInput != null ? (cached != null ? Math.max(0, rawInput - cached) : rawInput) : undefined;
    outputTokens = msg.tokens.output;
    reasoningTokens = msg.tokens.thoughts;
    cacheReadTokens = cached;
    cachedInputTokens = cached;
  } else if (msg.usageMetadata) {
    // Legacy API-response shape.
    const cached = msg.usageMetadata.cachedContentTokenCount;
    const rawInput = msg.usageMetadata.promptTokenCount;
    inputTokens =
      rawInput != null ? (cached != null ? Math.max(0, rawInput - cached) : rawInput) : undefined;
    outputTokens = msg.usageMetadata.candidatesTokenCount;
    reasoningTokens = msg.usageMetadata.thoughtsTokenCount;
    cacheReadTokens = cached;
    cachedInputTokens = cached;
  }

  // Gemini records usage only on model turns (its `tokens` block); user/info
  // rows carry no usage by design. Do NOT fabricate estimates for them — that
  // would pollute totals with text-based guesses. Exact usage (when present) is
  // authoritative; absence means absence.
  return {
    id: msg.id || generateId(),
    sessionId,
    timestamp: msg.timestamp || msg.createTime || msg.lastUpdateTime,
    role,
    model,
    contentText: options?.privacyMode === 'disabled' ? undefined : contentText,
    contentPreview: options?.privacyMode === 'disabled' ? `[${role} message]` : contentPreview,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cachedInputTokens,
    reasoningTokens,
    usageConfidence: inputTokens || outputTokens ? 'exact' : undefined,
    raw: shouldStoreRaw(options) ? msg : undefined,
  };
}

function resolveRole(msg: AnyMessage): NormalizedMessage['role'] {
  // Real CLI uses `type` ('user' | 'gemini' | 'info'); legacy uses `role`.
  const raw = (msg.type || msg.role || 'unknown').toLowerCase();
  if (raw === 'user') return 'user';
  if (raw === 'gemini' || raw === 'model' || raw === 'assistant') return 'assistant';
  if (raw === 'info') return 'system';
  if (raw === 'system') return 'system';
  return 'unknown';
}

function extractContentText(msg: AnyMessage): string {
  const content = msg.content ?? msg.parts;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === 'object' && p && 'text' in p
          ? String((p as { text?: string }).text || '')
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function buildSession(
  sessionId: string,
  messages: NormalizedMessage[],
  filePath: string,
  startedAt: string | undefined,
  updatedAt: string | undefined,
  projectHash: string | undefined,
): NormalizedSession {
  const totals = totalsFromMessages(messages);
  return {
    id: sessionId,
    provider: 'gemini',
    sourcePath: filePath,
    projectPath: path.dirname(filePath),
    projectName: path.basename(path.dirname(filePath)),
    startedAt,
    updatedAt,
    messages,
    totals,
    metadata: projectHash ? { projectHash } : undefined,
  };
}
