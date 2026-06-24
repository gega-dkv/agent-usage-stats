import fs from 'fs';
import path from 'path';
import { openProviderDatabase } from './provider-sqlite.js';
import type { ProviderParser, ParseResult, ParseOptions, NormalizedMessage } from '@agent-usage/shared';
import {
  applyPrivacyContent,
  buildSession,
  fileReadWarning,
  maybeEstimateTokens,
  newMessageId,
} from './parser-helpers.js';
import { parseJsonField } from './sqlite-helpers.js';

export const cursorParser: ProviderParser = {
  provider: 'cursor',

  canParse(filePath: string, _sample: string): boolean {
    return (
      (filePath.includes('.cursor') && (filePath.endsWith('state.vscdb') || filePath.endsWith('.db'))) ||
      (filePath.includes('cursor') && filePath.endsWith('.md'))
    );
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    if (filePath.endsWith('.db') || filePath.endsWith('state.vscdb')) return parseStateDb(filePath, options);
    if (filePath.endsWith('.md')) return parseMarkdown(filePath, options);
    return { sessions: [], warnings: [] };
  },
};

async function parseStateDb(filePath: string, options?: ParseOptions): Promise<ParseResult> {
  const allowEstimate = options?.estimatePromptOnlySources === true;
  const opened = openProviderDatabase(filePath);
  if (!opened.ok) return { sessions: [], warnings: [opened.warning] };

  const db = opened.db;
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const itemTable = tables.find((t) => t.name === 'ItemTable' || t.name === 'cursorDiskKV');
    if (!itemTable) {
      return {
        sessions: [],
        warnings: [
          {
            file: filePath,
            message: 'Cursor state database missing ItemTable',
            severity: 'warning',
            code: 'unknown-schema',
          },
        ],
      };
    }

    const rows = db
      .prepare(`SELECT key, value FROM ${itemTable.name} WHERE key LIKE '%composer%' OR key LIKE '%chat%' OR key LIKE '%prompt%'`)
      .all() as Array<{ key: string; value: string | Buffer }>;

    const messages: NormalizedMessage[] = [];
    const sessionId = path.basename(path.dirname(filePath));

    for (const row of rows) {
      const payload = parseJsonField(typeof row.value === 'string' ? row.value : row.value.toString());
      if (!payload) continue;
      const text = extractCursorText(payload);
      if (!text) continue;
      const role: NormalizedMessage['role'] = String(payload.role || '').toLowerCase() === 'assistant' ? 'assistant' : 'user';
      const inputTokens = readExplicitTokens(payload, 'input');
      const outputTokens = readExplicitTokens(payload, 'output');
      const privacy = applyPrivacyContent(role, text, options);
      const estimated = maybeEstimateTokens(role, inputTokens, outputTokens, text, allowEstimate);

      messages.push({
        id: newMessageId(),
        sessionId,
        role,
        ...privacy,
        inputTokens: estimated.inputTokens,
        outputTokens: estimated.outputTokens,
        usageConfidence:
          inputTokens || outputTokens
            ? 'exact'
            : estimated.estimated
              ? 'estimated-from-text'
              : 'metadata-only',
      });
    }

    if (messages.length === 0) {
      return {
        sessions: [],
        warnings: [
          {
            file: filePath,
            message: 'Cursor state database inspected but no parseable chat/composer entries found',
            severity: 'warning',
            code: 'missing-token-fields',
          },
        ],
      };
    }

    return {
      sessions: [
        buildSession(sessionId, 'cursor', messages, {
          sourcePath: filePath,
          storageKind: 'sqlite',
          supportLevel: 'prompt-history-only',
          usageConfidence: messages.some((m) => m.usageConfidence === 'exact')
            ? 'exact'
            : allowEstimate
              ? 'estimated-from-text'
              : 'metadata-only',
          tokenUsageEstimated: allowEstimate && !messages.some((m) => m.usageConfidence === 'exact'),
        }),
      ],
      warnings: [],
    };
  } finally {
    db.close();
  }
}

async function parseMarkdown(filePath: string, options?: ParseOptions): Promise<ParseResult> {
  const warnings: ParseResult['warnings'] = [];
  const allowEstimate = options?.estimatePromptOnlySources === true;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const sessionId = path.basename(filePath, '.md');
    const role: NormalizedMessage['role'] = 'user';
    const privacy = applyPrivacyContent(role, content, options);
    const estimated = maybeEstimateTokens(role, undefined, undefined, content, allowEstimate);
    const message: NormalizedMessage = {
      id: newMessageId(),
      sessionId,
      role,
      ...privacy,
      inputTokens: estimated.inputTokens,
      outputTokens: estimated.outputTokens,
      usageConfidence: estimated.estimated ? 'estimated-from-text' : 'metadata-only',
    };
    return {
      sessions: [
        buildSession(sessionId, 'cursor', [message], {
          sourcePath: filePath,
          storageKind: 'markdown',
          supportLevel: 'prompt-history-only',
          usageConfidence: estimated.estimated ? 'estimated-from-text' : 'metadata-only',
          tokenUsageEstimated: estimated.estimated,
        }),
      ],
      warnings,
    };
  } catch (error) {
    warnings.push(fileReadWarning(filePath, error));
    return { sessions: [], warnings };
  }
}

function extractCursorText(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.content === 'string') return payload.content;
  if (Array.isArray(payload.messages)) {
    return payload.messages
      .map((m) => (typeof m === 'object' && m && 'content' in m ? String((m as { content?: string }).content || '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return undefined;
}

function readExplicitTokens(payload: Record<string, unknown>, side: 'input' | 'output'): number | undefined {
  const usage = payload.usage as Record<string, number> | undefined;
  if (!usage) return undefined;
  const key = side === 'input' ? 'input_tokens' : 'output_tokens';
  const value = usage[key];
  return typeof value === 'number' ? value : undefined;
}
