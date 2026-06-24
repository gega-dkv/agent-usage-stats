import fs from 'fs';
import readline from 'readline';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedMessage,
  NormalizedSession,
} from '@agent-usage/shared';
import { generateId, truncateText, estimateTokensFromText, totalsFromMessages } from '@agent-usage/shared';
import { shouldStoreRaw } from './parser-helpers.js';

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ClaudeContentBlock = { type: string; text?: string; name?: string; input?: unknown };

/**
 * Claude session records come in two shapes:
 * - Real Claude Code logs: top-level `type` is "assistant"/"user", with model,
 *   usage, id and content living under a nested `message` object, plus an
 *   optional `requestId`. Assistant turns are emitted as many cumulative
 *   streaming chunks sharing the same `message.id` + `requestId`.
 * - Simplified/legacy fixtures: top-level `type:"message"`, `role`, `model`
 *   and `usage` sit on the record itself, identified by `uuid`.
 */
type ClaudeMessage = {
  type?: string;
  role?: string;
  content?: string | ClaudeContentBlock[];
  model?: string;
  usage?: ClaudeUsage;
  timestamp?: string;
  cost_usd?: number;
  session_id?: string;
  parent_id?: string;
  uuid?: string;
  requestId?: string;
  // Nested (real Claude Code) shape
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: string | ClaudeContentBlock[];
    usage?: ClaudeUsage;
  };
};

export const claudeParser: ProviderParser = {
  provider: 'claude',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.endsWith('.jsonl')) return false;

    // Path is the most reliable signal: Claude Code session logs live under
    // `.claude/projects/`. A session often opens with large metadata rows
    // (file-history snapshots, queue operations) that push the first real
    // message past the caller's ~4 KB content sample, so a content-only check
    // misses most real sessions and they get silently dropped on sync.
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (normalizedPath.includes('/.claude/projects/')) return true;

    try {
      const lines = sample.split('\n').filter(Boolean);
      if (lines.length === 0) return false;
      // Check first few lines for a Claude conversation or metadata record.
      for (const line of lines.slice(0, 10)) {
        try {
          const r = JSON.parse(line);
          if (
            r.type === 'message' ||
            r.type === 'assistant' ||
            r.type === 'user' ||
            r.role === 'user' ||
            r.role === 'assistant' ||
            r.role === 'human' ||
            r.type === 'summary' ||
            // Claude Code session metadata rows — distinctive to its JSONL
            // format and frequently the only complete records in the sample.
            r.type === 'last-prompt' ||
            r.type === 'queue-operation' ||
            r.type === 'file-history-snapshot' ||
            r.type === 'permission-mode' ||
            r.type === 'mode' ||
            r.type === 'ai-title' ||
            (typeof r.uuid === 'string' && typeof r.type === 'string')
          ) {
            return true;
          }
        } catch {
          // skip invalid line
        }
      }
      return false;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];

    try {
      return await parseClaudeJsonl(filePath, options);
    } catch (e) {
      warnings.push({
        file: filePath,
        message: `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
        code: 'missing-file',
      });
      return { sessions: [], warnings };
    }
  },
};

async function parseClaudeJsonl(
  filePath: string,
  options?: ParseOptions,
): Promise<ParseResult> {
  const sessions = new Map<string, NormalizedSession>();
  const warnings: ParseResult['warnings'] = [];
  const messagesBySession = new Map<string, NormalizedMessage[]>();
  // Per-session dedup map: canonical assistant key (messageId:requestId) -> index
  // into the session's message array. Streaming chunks share a key and collapse
  // onto the last (cumulative) occurrence.
  const dedupIndex = new Map<string, Map<string, number>>();

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentSessionId = '';
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    try {
      const record: ClaudeMessage = JSON.parse(line);

      if (record.session_id) {
        currentSessionId = record.session_id;
      } else if (!currentSessionId) {
        currentSessionId = path.basename(filePath, '.jsonl');
      }

      if (!messagesBySession.has(currentSessionId)) {
        messagesBySession.set(currentSessionId, []);
      }

      if (record.type === 'summary' || record.type === 'system') continue;

      // Resolve the canonical shape: prefer the nested `message` object when
      // present (real Claude Code logs), otherwise fall back to top-level fields.
      const nested = isObject(record.message) ? record.message : undefined;
      const role = mapClaudeRole(
        record.role ?? record.type ?? nested?.role ?? 'unknown',
      );
      const contentSource = nested?.content ?? record.content;
      const contentText = extractContentText(contentSource);
      const contentPreview = truncateText(contentText || '', 200);

      const usage = nested?.usage ?? record.usage ?? {};
      const model = nested?.model ?? record.model;
      const messageId = nested?.id ?? record.uuid;

      // `<synthetic>` rows are local-only placeholders Claude Code injects (API
      // errors, interrupted turns). They carry no real usage, so skip them
      // rather than counting zeros or fabricating a text estimate.
      if (model === '<synthetic>') continue;

      const cacheCreationTokens = usage.cache_creation_input_tokens;
      const cacheReadTokens = usage.cache_read_input_tokens;
      const cachedInputTokens =
        cacheCreationTokens || cacheReadTokens
          ? (cacheCreationTokens || 0) + (cacheReadTokens || 0)
          : undefined;
      const inputTokens = usage.input_tokens;
      const outputTokens = usage.output_tokens;

      const hasUsageBlock =
        inputTokens != null ||
        outputTokens != null ||
        cacheCreationTokens != null ||
        cacheReadTokens != null;

      // Real usage was provided for this row but every field is zero/absent.
      // Skip it rather than fabricating counts from text.
      const allZero =
        hasUsageBlock &&
        !inputTokens &&
        !outputTokens &&
        !cacheCreationTokens &&
        !cacheReadTokens;
      if (allZero) continue;

      // Real usage in Claude Code lives on assistant turns and is cumulative —
      // the assistant's `input_tokens` already includes the user prompt that
      // preceded it. So we never estimate *user* tokens from text (that would
      // double-count). Only an assistant message with no usage block at all
      // falls back to a text estimate of its output.
      const estInput = inputTokens;
      let estOutput = outputTokens;
      let estimated = false;
      if (!hasUsageBlock && role === 'assistant' && !estOutput) {
        estOutput = estimateTokensFromText(contentText || '');
        estimated = true;
      }

      let toolName: string | undefined;
      let toolInputPreview: string | undefined;
      let toolOutputPreview: string | undefined;

      if (Array.isArray(contentSource)) {
        for (const block of contentSource) {
          if (block.type === 'tool_use') {
            toolName = block.name;
            toolInputPreview = truncateText(JSON.stringify(block.input || ''), 200);
          }
          if (block.type === 'tool_result') {
            toolOutputPreview = truncateText(
              typeof block.text === 'string' ? block.text : JSON.stringify(block),
              200,
            );
          }
        }
      }

      const message: NormalizedMessage = {
        id: messageId || generateId(),
        sessionId: currentSessionId,
        timestamp: record.timestamp,
        role,
        model,
        contentText: options?.privacyMode === 'disabled' ? undefined : contentText,
        contentPreview:
          options?.privacyMode === 'disabled'
            ? `[${role} message]`
            : contentPreview,
        inputTokens: estInput,
        outputTokens: estOutput,
        cachedInputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        toolName,
        toolInputPreview: options?.privacyMode === 'disabled' ? undefined : toolInputPreview,
        toolOutputPreview: options?.privacyMode === 'disabled' ? undefined : toolOutputPreview,
        metadata: maybeClaudeMetadata(record, model),
        usageConfidence: hasUsageBlock
          ? 'exact'
          : estimated
            ? 'estimated-from-text'
            : undefined,
        raw: shouldStoreRaw(options) ? record : undefined,
      };

      // Collapse cumulative streaming chunks: when an assistant row reuses the
      // same (messageId, requestId) key, the latest row holds the cumulative
      // totals, so replace the prior row in place instead of appending a
      // second one (which would double-count tokens).
      const dedupKey = claudeDedupKey(messageId, record.requestId);
      if (role === 'assistant' && dedupKey) {
        const sessionMap = getOrInit(dedupIndex, currentSessionId, () => new Map());
        const priorIdx = sessionMap.get(dedupKey);
        const list = messagesBySession.get(currentSessionId)!;
        if (priorIdx !== undefined && priorIdx < list.length) {
          list[priorIdx] = message;
        } else {
          sessionMap.set(dedupKey, list.length);
          list.push(message);
        }
      } else {
        messagesBySession.get(currentSessionId)!.push(message);
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

  for (const [sessionId, messages] of messagesBySession) {
    const totals = totalsFromMessages(messages);
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];

    sessions.set(sessionId, {
      id: sessionId,
      provider: 'claude',
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

/** Returns the canonical dedup key for a Claude assistant turn. */
function claudeDedupKey(messageId: string | undefined, requestId: string | undefined): string | null {
  if (!messageId) return null;
  return `${messageId}:${requestId ?? ''}`;
}

/**
 * Detects Vertex AI-served rows (model like `claude-…@…`, or `_vrtx_` markers
 * in the message id / requestId) and records the flag on message metadata for
 * downstream filtering. No filtering modes are applied here.
 */
function maybeClaudeMetadata(
  record: ClaudeMessage,
  model: string | undefined,
): Record<string, unknown> | undefined {
  const vertex = isVertexRow(record, model);
  if (!vertex) return undefined;
  return { vertex: true };
}

function isVertexRow(record: ClaudeMessage, model: string | undefined): boolean {
  const messageId = record.message?.id;
  if (messageId && messageId.includes('_vrtx_')) return true;
  if (record.requestId && record.requestId.includes('_vrtx_')) return true;
  if (model && model.startsWith('claude-') && model.includes('@')) return true;
  return false;
}

function mapClaudeRole(role: string): NormalizedMessage['role'] {
  switch (role.toLowerCase()) {
    case 'human':
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'tool':
    case 'tool_result':
      return 'tool';
    default:
      return 'unknown';
  }
}

function extractContentText(
  content: string | ClaudeContentBlock[] | undefined,
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('\n');
  }
  return '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getOrInit<K, V>(map: Map<K, V>, key: K, init: () => V): V {
  const existing = map.get(key);
  if (existing) return existing;
  const value = init();
  map.set(key, value);
  return value;
}
