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

type GeminiMessage = {
  role?: string;
  parts?: Array<{ text?: string; inlineData?: unknown }>;
  model?: string;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  createTime?: string;
  lastUpdateTime?: string;
};

export const geminiParser: ProviderParser = {
  provider: 'gemini',

  canParse(_filePath: string, sample: string): boolean {
    // Check for Gemini-specific paths or content
    try {
      const trimmed = sample.trim();
      if (!trimmed) return false;
      // Try parsing as JSON
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const data = JSON.parse(trimmed);
        // Gemini chat files have a "messages" array, "chatId", or "usageMetadata"
        if (Array.isArray(data)) {
          return data.some(
            (m: any) =>
              m?.usageMetadata !== undefined ||
              m?.parts !== undefined ||
              m?.role === 'model' ||
              m?.role === 'user',
          );
        }
        if (typeof data === 'object' && data !== null) {
          return (
            data.chatId !== undefined ||
            data.usageMetadata !== undefined ||
            Array.isArray(data.messages) ||
            (Array.isArray(data.parts) && data.role !== undefined)
          );
        }
      }
      return false;
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParserOptions): Promise<ParseResult> {
    const sessions: NormalizedSession[] = [];
    const warnings: ParseResult['warnings'] = [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Handle both array and object formats
      const messages: GeminiMessage[] = Array.isArray(data) ? data : data.messages || [];

      if (messages.length === 0) return { sessions: [], warnings: [] };

      const sessionId = data.chatId || generateId();
      const normalizedMessages: NormalizedMessage[] = [];

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const role = mapGeminiRole(msg.role || 'unknown');
        const contentText = extractGeminiText(msg.parts);
        const contentPreview = truncateText(contentText || '', 200);

        // Extract token usage from metadata
        const usage = msg.usageMetadata || {};
        const inputTokens = usage.promptTokenCount || undefined;
        const outputTokens = usage.candidatesTokenCount || undefined;

        // Estimate if not provided
        let estInput = inputTokens;
        let estOutput = outputTokens;
        if (!estInput && role === 'user') estInput = estimateTokensFromText(contentText || '');
        if (!estOutput && role === 'assistant') estOutput = estimateTokensFromText(contentText || '');

        normalizedMessages.push({
          id: generateId(),
          sessionId,
          timestamp: msg.createTime || msg.lastUpdateTime,
          role,
          model: msg.model,
          contentText: options?.privacyMode === 'disabled' ? undefined : contentText,
          contentPreview:
            options?.privacyMode === 'disabled'
              ? `[${role} message]`
              : contentPreview,
          inputTokens: estInput,
          outputTokens: estOutput,
          raw: options?.privacyMode === 'raw' ? msg : undefined,
        });
      }

      const totals = computeSessionTotals(normalizedMessages);

      sessions.push({
        id: sessionId,
        provider: 'gemini',
        projectPath: path.dirname(filePath),
        projectName: path.basename(path.dirname(filePath)),
        startedAt: data.createTime,
        updatedAt: data.lastUpdateTime,
        messages: normalizedMessages,
        totals,
      });
    } catch (e) {
      warnings.push({
        file: filePath,
        message: `Failed to parse Gemini file: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
      });
    }

    return { sessions, warnings };
  },
};

function mapGeminiRole(role: string): NormalizedMessage['role'] {
  switch (role.toLowerCase()) {
    case 'user':
      return 'user';
    case 'model':
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    default:
      return 'unknown';
  }
}

function extractGeminiText(parts: GeminiMessage['parts']): string {
  if (!parts) return '';
  return parts
    .filter((p) => p.text)
    .map((p) => p.text!)
    .join('\n');
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
