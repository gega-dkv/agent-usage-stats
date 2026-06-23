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

type CodexEvent = {
  timestamp?: string;
  type: string;
  payload?: unknown;
};

// MARK: - Per-turn token-delta helpers (ported from scanner.md)
//
// Codex session logs emit a `token_count` event after every assistant turn.
// Each carries both a cumulative `total_token_usage` (for the whole session so
// far) and a `last_token_usage` (for just the preceding turn). Real logs are
// inconsistent: sometimes `last_*` is the reliable per-turn delta, sometimes
// the cumulative `total_*` minus the previous total is. scanner.md resolves
// this with a small heuristic that prefers the total-delta when the totals are
// monotonic and the total-delta does not exceed the last-delta, and bails out
// to last-delta as soon as the totals diverge from what we've counted.

type CodexTotals = { input: number; cached: number; output: number };
type CodexUsageDelta = { input: number; cached: number; output: number; reasoning: number };
type CodexUsageTurn = { timestamp: string; model: string; delta: CodexUsageDelta };

function codexZeroTotals(): CodexTotals {
  return { input: 0, cached: 0, output: 0 };
}

function codexAddTotals(a: CodexTotals, b: CodexTotals): CodexTotals {
  return { input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output };
}

function codexTotalsDelta(from: CodexTotals | null, to: CodexTotals): CodexTotals {
  const baseline = from ?? codexZeroTotals();
  return {
    input: Math.max(0, to.input - baseline.input),
    cached: Math.max(0, to.cached - baseline.cached),
    output: Math.max(0, to.output - baseline.output),
  };
}

function codexTotalsEqual(a: CodexTotals | null, b: CodexTotals | null): boolean {
  return (
    (a?.input ?? 0) === (b?.input ?? 0) &&
    (a?.cached ?? 0) === (b?.cached ?? 0) &&
    (a?.output ?? 0) === (b?.output ?? 0)
  );
}

function codexTotalsAtLeast(a: CodexTotals, b: CodexTotals): boolean {
  return a.input >= b.input && a.cached >= b.cached && a.output >= b.output;
}

function codexTotalsAtMost(a: CodexTotals, b: CodexTotals): boolean {
  return a.input <= b.input && a.cached <= b.cached && a.output <= b.output;
}

// Mirrors CostUsageScanner+Codex.shouldPreferTotalDelta. Prefer the delta
// computed from cumulative totals when those totals are monotonic over the
// baseline AND the resulting delta is no larger than the reported last-delta.
// Once totals ever diverge from what we counted, totals are unreliable and we
// stop trusting the total-delta path.
function shouldPreferTotalDelta(
  rawBaseline: CodexTotals | null,
  currentTotal: CodexTotals,
  totalDelta: CodexTotals,
  lastDelta: CodexTotals,
  sawDivergentTotals: boolean,
): boolean {
  if (sawDivergentTotals || rawBaseline === null) return false;
  return codexTotalsAtLeast(currentTotal, rawBaseline) && codexTotalsAtMost(totalDelta, lastDelta);
}

/** Round arbitrary JSON values to non-negative integers (ports scanner.md toInt). */
function codexToInt(value: unknown): number {
  if (typeof value === 'number') return Math.round(value);
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  if (value && typeof value === 'object' && 'valueOf' in value) {
    const n = Number((value as { valueOf(): number }).valueOf());
    return Number.isFinite(n) ? Math.round(n) : 0;
  }
  return 0;
}

/**
 * Extract a turn_context model from a truncated JSONL prefix. When a
 * turn_context line exceeds the read cap it is delivered as a truncated buffer;
 * the model can still be recovered with a minimal streaming JSON field scan.
 * Ports extractCodexTurnContextModel from scanner.md.
 */
function extractCodexTurnContextModel(text: string): string | null {
  if (extractCodexJSONStringField('type', text) !== 'turn_context') return null;
  const payloadText = extractCodexJSONObjectField('payload', text);
  if (!payloadText) return null;
  const payloadModel =
    extractCodexJSONStringField('model', payloadText) ??
    extractCodexJSONStringField('model_name', payloadText);
  if (payloadModel) return payloadModel;
  const infoText = extractCodexJSONObjectField('info', payloadText);
  if (!infoText) return null;
  return (
    extractCodexJSONStringField('model', infoText) ??
    extractCodexJSONStringField('model_name', infoText)
  );
}

function locateCodexJSONField(field: string, text: string): number | null {
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      depth++;
      i++;
    } else if (ch === '}') {
      depth--;
      i++;
    } else if (ch === '"') {
      let key = '';
      i++;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\' && i + 1 < text.length) {
          key += text[i + 1];
          i += 2;
        } else if (c === '"') {
          i++;
          break;
        } else {
          key += c;
          i++;
        }
      }
      if (depth === 1 && key === field) {
        while (i < text.length && /\s/.test(text[i]!)) i++;
        if (i < text.length && text[i] === ':') {
          i++;
          while (i < text.length && /\s/.test(text[i]!)) i++;
          return i;
        }
      }
    } else {
      i++;
    }
  }
  return null;
}

function extractCodexJSONStringField(field: string, text: string): string | null {
  const idx = locateCodexJSONField(field, text);
  if (idx === null) return null;
  return parseCodexJSONString(text, idx);
}

function extractCodexJSONObjectField(field: string, text: string): string | null {
  const idx = locateCodexJSONField(field, text);
  if (idx === null || idx >= text.length || text[idx] !== '{') return null;
  return text.slice(idx);
}

function parseCodexJSONString(text: string, startIndex: number): string | null {
  if (startIndex >= text.length || text[startIndex] !== '"') return null;
  let i = startIndex + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\' && i + 1 < text.length) {
      value += text[i + 1];
      i += 2;
    } else if (ch === '"') {
      return value;
    } else {
      value += ch;
      i++;
    }
  }
  return null;
}

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
  let currentModel: string | undefined;
  let authoritatveTotalTokens: number | undefined;

  // Per-turn delta state (ports scanner.md parseCodexFile).
  let previousTotals: CodexTotals | null = null;
  let rawTotalsBaseline: CodexTotals | null = null;
  let sawDivergentTotals = false;
  const turns: CodexUsageTurn[] = [];

  // session_meta fork metadata. A forked session inherits its parent's token
  // totals at the fork timestamp so inherited tokens are not double-counted; we
  // model that by seeding the delta baselines with the parent's last totals.
  let forkParentId: string | undefined;
  let forkInheritSeed: CodexTotals | null = null;

  await scanCodexBoundedLines(filePath, (line, lineNum, truncated) => {
    // Truncated lines can only contribute a turn_context model; everything
    // else is dropped (matches scanner.md).
    if (truncated) {
      const m = extractCodexTurnContextModel(line);
      if (m) currentModel = m;
      return;
    }
    if (!line.trim()) return;

    try {
      const record: CodexEvent = JSON.parse(line);
      if (record.timestamp) lastTimestamp = record.timestamp;

      if (record.type === 'session_meta' && isObject(record.payload)) {
        const p = record.payload;
        if (typeof p.id === 'string') sessionId = p.id;
        if (typeof p.timestamp === 'string') startedAt = p.timestamp;
        // Fork bookkeeping. We only consume the seed once the forked file
        // actually starts emitting usage (see the token_count branch).
        if (typeof p.forked_from === 'string' || typeof p.parent_id === 'string') {
          forkParentId = (p.forked_from as string) ?? (p.parent_id as string);
        }
        const inherited = p.inherited_token_usage ?? p.fork_token_usage;
        if (isObject(inherited)) {
          forkInheritSeed = codexTotalsFromUsage(inherited);
        }
        return;
      }

      if (record.type === 'turn_context' && isObject(record.payload)) {
        const p = record.payload;
        if (typeof p.model === 'string') {
          currentModel = p.model;
        } else {
          const info = isObject(p.info) ? p.info : undefined;
          if (info && typeof info.model === 'string') currentModel = info.model;
        }
        return;
      }

      if (record.type !== 'event_msg' || !isObject(record.payload)) return;
      const p = record.payload;
      if (p.type === 'task_started') return;
      if (p.type !== 'token_count') return;

      const info = isObject(p.info) ? p.info : {};
      const modelFromInfo =
        (typeof info.model === 'string' ? info.model : undefined) ??
        (typeof info.model_name === 'string' ? info.model_name : undefined) ??
        (typeof p.model === 'string' ? p.model : undefined) ??
        (typeof (record as { model?: string }).model === 'string'
          ? (record as { model?: string }).model
          : undefined);
      const model = currentModel ?? modelFromInfo ?? 'gpt-5';

      const total = isObject(info.total_token_usage) ? info.total_token_usage : undefined;
      const last = isObject(info.last_token_usage) ? info.last_token_usage : undefined;

      // Seed the delta baselines from inherited fork totals on the first usage
      // event of a forked session, so tokens already counted in the parent are
      // excluded from this file's per-turn deltas.
      if (forkParentId && forkInheritSeed && previousTotals === null) {
        previousTotals = forkInheritSeed;
        rawTotalsBaseline = forkInheritSeed;
      }

      const delta = computeCodexTurnDelta({
        last,
        total,
        rawTotalsBaseline,
        sawDivergentTotals,
      });

      // Update the running totals the same way scanner.md does, and record
      // divergence so the total-delta heuristic disables itself if needed.
      const updated = applyCodexTurn(
        last,
        total,
        delta,
        previousTotals,
        sawDivergentTotals,
      );
      previousTotals = updated.counted;
      rawTotalsBaseline = updated.rawBaseline;
      sawDivergentTotals = sawDivergentTotals || updated.diverged;

      // Track the authoritative grand total reported by the final token_count.
      const grand = isObject(total) ? total : undefined;
      if (grand && typeof grand.total_tokens === 'number') {
        authoritatveTotalTokens = grand.total_tokens;
      }

      const input = delta.input;
      const cached = Math.min(delta.cached, input); // clamp cached <= input
      const output = delta.output;
      const reasoning =
        (last && typeof last.reasoning_output_tokens === 'number'
          ? last.reasoning_output_tokens
          : undefined) ??
        (total && typeof total.reasoning_output_tokens === 'number'
          ? total.reasoning_output_tokens
          : undefined) ??
        0;
      if (input === 0 && cached === 0 && output === 0 && reasoning === 0) return;

      const ts = record.timestamp ?? lastTimestamp ?? startedAt;
      if (!ts) return;
      turns.push({ timestamp: ts, model, delta: { input, cached, output, reasoning } });
    } catch (e) {
      warnings.push({
        file: filePath,
        line: lineNum,
        message: `Failed to parse line: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'warning',
        code: 'json-parse-error',
      });
    }
  });

  if (!sessionId) {
    sessionId = normalizeSessionIdFromPath(filePath);
  }

  if (turns.length === 0) {
    warnings.push({
      file: filePath,
      message: 'No token_count events found in Codex session',
      severity: 'warning',
      code: 'missing-token-fields',
    });
  }

  // Build one assistant usage message per turn. The pricing engine treats
  // `inputTokens` as NON-cached input and `cachedInputTokens`/`cacheReadTokens`
  // as the discounted portion, so we subtract cached from input per turn.
  const usageMessages: NormalizedMessage[] = turns.map((turn, idx) => {
    const nonCachedInput = Math.max(0, turn.delta.input - turn.delta.cached);
    return {
      id: generateId(),
      sessionId,
      timestamp: turn.timestamp,
      role: 'assistant',
      model: turn.model,
      contentPreview: idx === 0 ? '[token usage]' : '[token usage]',
      inputTokens: nonCachedInput || undefined,
      outputTokens: turn.delta.output || undefined,
      cachedInputTokens: turn.delta.cached || undefined,
      cacheReadTokens: turn.delta.cached || undefined,
      reasoningTokens: turn.delta.reasoning || undefined,
      usageConfidence: 'cumulative-delta',
      raw: shouldStoreRaw(options) ? undefined : undefined,
    };
  });

  const hasExactUsage = turns.length > 0;
  const session = buildSession(sessionId, 'codex', usageMessages, {
    sourcePath: filePath,
    projectPath: path.dirname(filePath),
    projectName: path.basename(path.dirname(filePath)),
    startedAt,
    updatedAt: lastTimestamp ?? startedAt,
    supportLevel: hasExactUsage ? 'exact-usage' : 'partial-usage',
    usageConfidence: hasExactUsage ? 'cumulative-delta' : 'estimated-from-text',
    tokenUsageEstimated: !hasExactUsage,
  });

  // Codex's reported grand total_tokens is authoritative (it may not equal the
  // sum of input/cached/output/reasoning depending on how the CLI counts them).
  if (authoritatveTotalTokens != null) {
    session.totals.totalTokens = authoritatveTotalTokens;
  }

  return { sessions: [session], warnings };
}

/** Read a Codex JSONL file line-by-line with a byte cap, surfacing truncation. */
async function scanCodexBoundedLines(
  filePath: string,
  onLine: (line: string, lineNum: number, truncated: boolean) => void,
): Promise<void> {
  const maxLineBytes = 256 * 1024;
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const truncated = Buffer.byteLength(line, 'utf-8') > maxLineBytes;
    onLine(truncated ? line.slice(0, maxLineBytes) : line, lineNum, truncated);
  }
}

function codexTotalsFromUsage(usage: Record<string, unknown>): CodexTotals {
  return {
    input: codexToInt(usage.input_tokens),
    cached: codexToInt(usage.cached_input_tokens ?? usage.cache_read_input_tokens),
    output: codexToInt(usage.output_tokens),
  };
}

/**
 * Compute the per-turn delta using scanner.md's reliability heuristic.
 * Prefers total-delta over last-delta when cumulative totals are monotonic and
 * the total-delta is no larger than last-delta; bails out once totals diverge.
 */
function computeCodexTurnDelta(args: {
  last: Record<string, unknown> | undefined;
  total: Record<string, unknown> | undefined;
  rawTotalsBaseline: CodexTotals | null;
  sawDivergentTotals: boolean;
}): CodexTotals {
  const { last, total, rawTotalsBaseline, sawDivergentTotals } = args;

  if (last) {
    const rawDelta: CodexTotals = {
      input: Math.max(0, codexToInt(last.input_tokens)),
      cached: Math.max(0, codexToInt(last.cached_input_tokens ?? last.cache_read_input_tokens)),
      output: Math.max(0, codexToInt(last.output_tokens)),
    };
    if (total) {
      const rawTotals: CodexTotals = {
        input: codexToInt(total.input_tokens),
        cached: codexToInt(total.cached_input_tokens ?? total.cache_read_input_tokens),
        output: codexToInt(total.output_tokens),
      };
      const totalDelta = codexTotalsDelta(rawTotalsBaseline, rawTotals);
      if (shouldPreferTotalDelta(rawTotalsBaseline, rawTotals, totalDelta, rawDelta, sawDivergentTotals)) {
        return totalDelta;
      }
    }
    return rawDelta;
  }

  if (total) {
    const rawTotals: CodexTotals = {
      input: codexToInt(total.input_tokens),
      cached: codexToInt(total.cached_input_tokens ?? total.cache_read_input_tokens),
      output: codexToInt(total.output_tokens),
    };
    return codexTotalsDelta(rawTotalsBaseline, rawTotals);
  }

  return codexZeroTotals();
}

/**
 * Fold a turn's delta into the running counters exactly as scanner.md does, and
 * detect divergence between the raw cumulative totals and what we've counted.
 */
function applyCodexTurn(
  last: Record<string, unknown> | undefined,
  total: Record<string, unknown> | undefined,
  delta: CodexTotals,
  previousTotals: CodexTotals | null,
  sawDivergentTotals: boolean,
): { counted: CodexTotals; rawBaseline: CodexTotals | null; diverged: boolean } {
  const prev = previousTotals ?? codexZeroTotals();
  const counted = codexAddTotals(prev, delta);
  let diverged = sawDivergentTotals;

  if (last && total) {
    const rawTotals: CodexTotals = {
      input: codexToInt(total.input_tokens),
      cached: codexToInt(total.cached_input_tokens ?? total.cache_read_input_tokens),
      output: codexToInt(total.output_tokens),
    };
    if (!codexTotalsEqual(rawTotals, counted)) diverged = true;
    return { counted, rawBaseline: rawTotals, diverged };
  }

  // No cumulative totals on this row: trust our counted totals as the baseline.
  return { counted, rawBaseline: counted, diverged };
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
