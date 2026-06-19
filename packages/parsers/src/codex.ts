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
import { generateId, truncateText, estimateTokensFromText, totalsFromMessages } from '@agent-usage/shared';
import { shouldStoreRaw } from './parser-helpers.js';

type CodexMessage = {
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

export const codexParser: ProviderParser = {
  provider: 'codex',

  canParse(_filePath: string, sample: string): boolean {
    try {
      const trimmed = sample.trim();
      if (!trimmed) return false;
      // Try as single JSON
      if (trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed);
          // Object with messages/conversation/history/session, or single message record
          if (typeof data === 'object' && data !== null) {
            if (
              Array.isArray(data.messages) ||
              Array.isArray(data.conversation) ||
              Array.isArray(data.history) ||
              Array.isArray(data.session) ||
              data.role !== undefined ||
              data.usage !== undefined
            ) {
              return true;
            }
          }
        } catch {
          // Not valid JSON, try JSONL
        }
      }
      // Try as array JSON
      if (trimmed.startsWith('[')) {
        try {
          const data = JSON.parse(trimmed);
          if (Array.isArray(data) && data.length > 0) {
            return data.some(
              (m: any) =>
                m?.role !== undefined ||
                m?.usage !== undefined ||
                m?.type !== undefined,
            );
          }
        } catch {
          // Not valid
        }
      }
      // Try JSONL
      const lines = trimmed.split('\n').filter(Boolean).slice(0, 10);
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (
            typeof r === 'object' && r !== null &&
            (r.role !== undefined || r.usage !== undefined || r.type !== undefined)
          ) {
            return true;
          }
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

      if (format === 'json') {
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

function detectCodexFormat(filePath: string): 'json' | 'jsonl' {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    const sample = buf.slice(0, bytesRead).toString('utf-8').trim();
    if (sample.startsWith('[')) return 'json';
    if (sample.startsWith('{') && sample.includes('"messages"')) return 'json';
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
  let messages: CodexMessage[] = [];

  if (Array.isArray(data)) {
    messages = data;
  } else if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.messages)) messages = obj.messages as CodexMessage[];
    else if (Array.isArray(obj.conversation)) messages = obj.conversation as CodexMessage[];
    else if (Array.isArray(obj.history)) messages = obj.history as CodexMessage[];
    else if (Array.isArray(obj.session)) messages = obj.session as CodexMessage[];
  }

  if (messages.length === 0) return { sessions: [], warnings: [] };

  const sessionId =
    (messages[0] as CodexMessage)?.session_id || generateId();
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
      const record: CodexMessage = JSON.parse(line);

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

function normalizeCodexMessage(
  msg: CodexMessage,
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
