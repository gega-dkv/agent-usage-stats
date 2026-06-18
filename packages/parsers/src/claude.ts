import fs from 'fs';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParserOptions,
  NormalizedSession,
  NormalizedMessage,
  TokenTotals,
} from '@agent-usage/shared';
import { generateId, truncateText, estimateTokensFromText, emptyTokenTotals } from '@agent-usage/shared';

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

  async parse(filePath: string, options?: ParserOptions): Promise<ParseResult> {
    const sessions = new Map<string, NormalizedSession>();
    const warnings: ParseResult['warnings'] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      let currentSessionId = '';
      const messagesBySession = new Map<string, NormalizedMessage[]>();

      for (let i = 0; i < lines.length; i++) {
        try {
          const record: ClaudeMessage = JSON.parse(lines[i]);

          // Determine session ID
          if (record.session_id) {
            currentSessionId = record.session_id;
          } else if (!currentSessionId) {
            currentSessionId = path.basename(filePath, '.jsonl');
          }

          if (!messagesBySession.has(currentSessionId)) {
            messagesBySession.set(currentSessionId, []);
          }

          // Skip non-message records (e.g., summary, system)
          if (record.type === 'summary' || record.type === 'system') continue;

          const role = mapClaudeRole(record.role || record.type || 'unknown');
          const contentText = extractContentText(record.content);
          const contentPreview = truncateText(contentText || '', 200);

          // Extract token usage
          const usage = record.usage || {};
          const inputTokens = usage.input_tokens || usage.cache_read_input_tokens || undefined;
          const outputTokens = usage.output_tokens || undefined;
          const cachedInputTokens = usage.cache_creation_input_tokens || usage.cache_read_input_tokens || undefined;

          // Estimate tokens if not provided
          let estInput = inputTokens;
          let estOutput = outputTokens;
          if (!estInput && role === 'user') estInput = estimateTokensFromText(contentText || '');
          if (!estOutput && role === 'assistant') estOutput = estimateTokensFromText(contentText || '');

          // Handle tool calls
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
            toolName,
            toolInputPreview,
            toolOutputPreview,
            raw: options?.privacyMode === 'raw' ? record : undefined,
          };

          messagesBySession.get(currentSessionId)!.push(message);
        } catch (e) {
          warnings.push({
            file: filePath,
            line: i + 1,
            message: `Failed to parse line: ${e instanceof Error ? e.message : String(e)}`,
            severity: 'warning',
          });
        }
      }

      // Build sessions
      for (const [sessionId, messages] of messagesBySession) {
        const totals = computeSessionTotals(messages);
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
    } catch (e) {
      warnings.push({
        file: filePath,
        message: `Failed to read file: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
      });
    }

    return { sessions: Array.from(sessions.values()), warnings };
  },
};

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

function computeSessionTotals(messages: NormalizedMessage[]): TokenTotals {
  const totals = emptyTokenTotals();
  for (const msg of messages) {
    totals.inputTokens += msg.inputTokens || 0;
    totals.outputTokens += msg.outputTokens || 0;
    totals.cachedInputTokens += msg.cachedInputTokens || 0;
    totals.reasoningTokens += msg.reasoningTokens || 0;
  }
  totals.totalTokens =
    totals.inputTokens + totals.outputTokens + totals.cachedInputTokens + totals.reasoningTokens;
  return totals;
}
