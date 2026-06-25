import fs from 'fs';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedMessage,
} from '@agent-usage/shared';
import {
  applyPrivacyContent,
  buildSession,
  fileReadWarning,
  newMessageId,
  shouldStoreRaw,
} from './parser-helpers.js';

type UsageRecord = Record<string, number>;

type CodebuffMessage = {
  id?: string;
  role?: string;
  content?: string;
  credits?: number;
  timestamp?: string;
  ts?: string;
  metadata?: {
    usage?: UsageRecord;
    codebuff?: { usage?: UsageRecord };
    runState?: {
      providerUsage?: UsageRecord;
      sessionState?: {
        mainAgentState?: { messageHistory?: Array<{ providerOptions?: UsageRecord }> };
      };
    };
  };
};

export const codebuffParser: ProviderParser = {
  provider: 'codebuff',

  canParse(filePath: string, sample: string): boolean {
    if (!filePath.includes('chat-messages.json')) return false;
    try {
      const data = JSON.parse(sample);
      return Array.isArray(data) || Array.isArray((data as { messages?: unknown[] }).messages);
    } catch {
      return false;
    }
  },

  async parse(filePath: string, options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];
    let fileMtime: string | undefined;
    try {
      fileMtime = fs.statSync(filePath).mtime.toISOString();
    } catch {
      // mtime is a best-effort timestamp fallback.
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const list: CodebuffMessage[] = Array.isArray(raw) ? raw : raw.messages || [];
      const chatDir = path.basename(path.dirname(filePath));
      const projectDir = path.basename(path.dirname(path.dirname(path.dirname(filePath))));
      const sessionId = chatDir;
      const messages: NormalizedMessage[] = [];

      // Walk the history in REVERSE so partial newer entries don't shadow
      // earlier ones that hold the real counts (doc §8.227). We still emit
      // messages in chronological order; the reverse walk only resolves which
      // usage source wins when two entries overlap.
      const resolved = list.map((msg) => ({ msg, usage: extractUsage(msg) }));

      for (const { msg, usage } of resolved) {
        const role =
          msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'unknown';
        const privacy = applyPrivacyContent(role, msg.content, options);
        const hasTokenUsage = usage.input != null || usage.output != null;
        // Codebuff bills in credits (doc §8.228). When no token-level data is
        // present but credits are, approximate cost at $0.01/credit.
        const credits = usage.credits ?? msg.credits;
        const creditCost = !hasTokenUsage && credits != null ? credits * 0.01 : undefined;

        messages.push({
          id: msg.id || newMessageId(),
          sessionId,
          role,
          // Timestamp fallback chain (doc §8.229): message ts → chat-id dir →
          // file mtime. Codebuff chat-id dirs are timestamps when available.
          timestamp: msg.timestamp || msg.ts || chatDir || fileMtime,
          ...privacy,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheCreationTokens: usage.cacheCreation,
          cacheReadTokens: usage.cacheRead,
          recordedCost: creditCost,
          usageConfidence: hasTokenUsage
            ? 'exact'
            : credits != null
              ? 'provider-recorded-cost'
              : 'metadata-only',
          metadata:
            credits != null
              ? { credits }
              : options?.privacyMode === 'full' || options?.privacyMode === 'raw'
                ? msg.metadata
                : undefined,
          raw: shouldStoreRaw(options) ? msg : undefined,
        });
      }

      if (messages.length === 0) {
        return { sessions: [], warnings };
      }

      const hasUsage = messages.some((m) => m.inputTokens || m.outputTokens);
      const totalRecordedCost = messages.reduce((sum, m) => sum + (m.recordedCost || 0), 0);

      return {
        sessions: [
          buildSession(sessionId, 'codebuff', messages, {
            sourcePath: filePath,
            storageKind: 'json',
            supportLevel: hasUsage ? 'exact-usage' : 'partial-usage',
            usageConfidence: hasUsage ? 'exact' : 'metadata-only',
            projectName: projectDir,
            costs: totalRecordedCost
              ? { recordedCost: totalRecordedCost, currency: 'USD', estimated: true }
              : undefined,
          }),
        ],
        warnings: hasUsage
          ? warnings
          : [
              ...warnings,
              {
                file: filePath,
                message: 'Codebuff messages found without usage metadata',
                severity: 'warning',
                code: 'missing-token-fields',
              },
            ],
      };
    } catch (error) {
      warnings.push(fileReadWarning(filePath, error));
      return { sessions: [], warnings };
    }
  },
};

/**
 * Resolve a message's token usage across the documented source chain (doc
 * §8.227): metadata.usage → metadata.codebuff.usage → the deep run-state
 * fallback `runState.sessionState.mainAgentState.messageHistory[*].providerOptions`.
 * `msg.credits` is read separately (top-level) at the call site.
 */
function extractUsage(msg: CodebuffMessage): {
  input?: number;
  output?: number;
  cacheCreation?: number;
  cacheRead?: number;
  credits?: number;
} {
  const metadata = msg.metadata;
  const sources: UsageRecord[] = [
    metadata?.usage,
    metadata?.codebuff?.usage,
    metadata?.runState?.providerUsage,
  ].filter(Boolean) as UsageRecord[];

  // Deep run-state fallback (doc §8.227): walk the main agent's message
  // history in REVERSE so partial newer entries override earlier ones, and
  // collect providerOptions from each entry. Newer first.
  const history = metadata?.runState?.sessionState?.mainAgentState?.messageHistory;
  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i]?.providerOptions;
      if (entry) sources.push(entry);
    }
  }

  // Prefer a non-zero value; fall back to the first numeric match so genuine
  // zero counts (e.g. outputTokens on a user turn) still surface.
  const pick = (...keys: string[]) => {
    let firstNumeric: number | undefined;
    for (const src of sources) {
      for (const key of keys) {
        const v = src[key];
        if (typeof v === 'number') {
          if (v > 0) return v;
          if (firstNumeric === undefined) firstNumeric = v;
        }
      }
    }
    return firstNumeric;
  };

  return {
    input: pick('inputTokens', 'input_tokens', 'promptTokens', 'input'),
    output: pick('outputTokens', 'output_tokens', 'completionTokens', 'output'),
    cacheCreation: pick('cacheCreationTokens', 'cache_creation_tokens', 'cacheWrite'),
    cacheRead: pick('cacheReadTokens', 'cache_read_tokens', 'cachedInput'),
    credits: pick('credits'),
  };
}
