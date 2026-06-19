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

type ClaudeMessage = {
  type?: string;
  role?: string;
  content?: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  timestamp?: string;
  cost_usd?: number;
  session_id?: string;
  parent_id?: string;
  uuid?: string;
};

export const claudeParser: ProviderParser = {
  provider: 'claude',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.endsWith('.jsonl')) return false;
    try {
      const lines = sample.split('\n').filter(Boolean);
      if (lines.length === 0) return false;
      // Check first few lines for a Claude message record
      for (const line of lines.slice(0, 10)) {
        try {
          const r = JSON.parse(line);
          if (
            r.type === 'message' ||
            r.role === 'user' ||
            r.role === 'assistant' ||
            r.role === 'human' ||
            r.type === 'summary' ||
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

      const role = mapClaudeRole(record.role || record.type || 'unknown');
      const contentText = extractContentText(record.content);
      const contentPreview = truncateText(contentText || '', 200);

      const usage = record.usage || {};
      const cacheCreationTokens = usage.cache_creation_input_tokens;
      const cacheReadTokens = usage.cache_read_input_tokens;
      const cachedInputTokens =
        cacheCreationTokens || cacheReadTokens
          ? (cacheCreationTokens || 0) + (cacheReadTokens || 0)
          : undefined;
      const inputTokens = usage.input_tokens || undefined;
      const outputTokens = usage.output_tokens || undefined;

      let estInput = inputTokens;
      let estOutput = outputTokens;
      if (!estInput && role === 'user') estInput = estimateTokensFromText(contentText || '');
      if (!estOutput && role === 'assistant') estOutput = estimateTokensFromText(contentText || '');

      let toolName: string | undefined;
      let toolInputPreview: string | undefined;
      let toolOutputPreview: string | undefined;

      if (Array.isArray(record.content)) {
        for (const block of record.content) {
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
        id: record.uuid || generateId(),
        sessionId: currentSessionId,
        timestamp: record.timestamp,
        role,
        model: record.model,
        contentText: options?.privacyMode === 'disabled' ? undefined : contentText,
        contentPreview:
          options?.privacyMode === 'disabled'
            ? `[${role} message]`
            : options?.privacyMode === 'preview'
              ? contentPreview
              : contentPreview,
        inputTokens: estInput,
        outputTokens: estOutput,
        cachedInputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        toolName,
        toolInputPreview: options?.privacyMode === 'disabled' ? undefined : toolInputPreview,
        toolOutputPreview: options?.privacyMode === 'disabled' ? undefined : toolOutputPreview,
        raw: shouldStoreRaw(options) ? record : undefined,
      };

      messagesBySession.get(currentSessionId)!.push(message);
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
  content: string | Array<{ type: string; text?: string }> | undefined,
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
