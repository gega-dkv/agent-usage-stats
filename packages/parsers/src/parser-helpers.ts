import fs from 'fs';
import readline from 'readline';
import type {
  ParseOptions,
  NormalizedMessage,
  NormalizedSession,
  Provider,
  ParserWarning,
  MessageRole,
  PrivacyMode,
} from '@agent-usage/shared';
import {
  generateId,
  truncateText,
  totalsFromMessages,
  PROVIDER_REGISTRY,
  estimateTokensFromText,
} from '@agent-usage/shared';

export async function streamJsonl<T>(
  filePath: string,
  onLine: (record: T, lineNum: number) => void,
  onError: (lineNum: number, error: unknown) => void,
): Promise<void> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;
    try {
      onLine(JSON.parse(line) as T, lineNum);
    } catch (error) {
      onError(lineNum, error);
    }
  }
}

const SAFE_METADATA_KEYS = new Set(['credits', 'traceId', 'spanName', 'provider', 'title']);

/** Whether provider-native raw records should be persisted for this parse. */
export function shouldStoreRaw(options?: ParseOptions): boolean {
  return options?.privacyMode === 'raw' || options?.storeRawRecords === true;
}

export function applyPrivacyContent(
  role: MessageRole,
  contentText: string | undefined,
  options?: ParseOptions,
): Pick<NormalizedMessage, 'contentText' | 'contentPreview' | 'contentHidden'> {
  if (options?.privacyMode === 'disabled' || !contentText) {
    return {
      contentText: undefined,
      contentPreview: `[${role} message]`,
      contentHidden: true,
    };
  }
  return {
    contentText: options?.privacyMode === 'full' || options?.privacyMode === 'raw' ? contentText : undefined,
    contentPreview: truncateText(contentText, 200),
    contentHidden: false,
  };
}

function sanitizeMetadata(
  metadata: NormalizedMessage['metadata'],
  privacyMode: PrivacyMode,
): NormalizedMessage['metadata'] {
  if (!metadata || privacyMode === 'full' || privacyMode === 'raw') return metadata;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SAFE_METADATA_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number')) {
      safe[key] = value;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** Final privacy gate applied after parser output (defense in depth). */
export function sanitizeMessageForPrivacy(
  msg: NormalizedMessage,
  privacyMode: PrivacyMode,
  storeRawRecords = false,
): NormalizedMessage {
  const storeRaw = privacyMode === 'raw' || storeRawRecords;

  if (privacyMode === 'disabled') {
    return {
      ...msg,
      contentText: undefined,
      contentPreview: `[${msg.role} message]`,
      contentHidden: true,
      toolInputPreview: undefined,
      toolOutputPreview: undefined,
      metadata: sanitizeMetadata(msg.metadata, privacyMode),
      raw: storeRaw ? msg.raw : undefined,
    };
  }

  if (privacyMode === 'preview') {
    return {
      ...msg,
      contentText: undefined,
      metadata: sanitizeMetadata(msg.metadata, privacyMode),
      raw: storeRaw ? msg.raw : undefined,
    };
  }

  return {
    ...msg,
    raw: storeRaw ? msg.raw : undefined,
  };
}

export function buildSession(
  sessionId: string,
  provider: Provider,
  messages: NormalizedMessage[],
  extra?: Partial<NormalizedSession>,
): NormalizedSession {
  const def = PROVIDER_REGISTRY[provider];
  return {
    id: sessionId,
    provider,
    messages,
    totals: totalsFromMessages(messages),
    supportLevel: def?.supportLevel,
    usageConfidence: def?.defaultConfidence,
    messageCount: messages.length,
    promptCount: messages.filter((m) => m.role === 'user').length,
    ...extra,
  };
}

export function fileReadWarning(filePath: string, error: unknown): ParserWarning {
  return {
    file: filePath,
    message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
    severity: 'error',
    code: 'missing-file',
  };
}

export function jsonParseWarning(filePath: string, error: unknown, line?: number): ParserWarning {
  return {
    file: filePath,
    line,
    message: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
    severity: 'warning',
    code: 'json-parse-error',
  };
}

export function maybeEstimateTokens(
  role: MessageRole,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  contentText: string | undefined,
  allowEstimate: boolean,
): { inputTokens?: number; outputTokens?: number; estimated: boolean } {
  let estInput = inputTokens;
  let estOutput = outputTokens;
  let estimated = false;
  if (allowEstimate) {
    if (!estInput && role === 'user') {
      estInput = estimateTokensFromText(contentText || '');
      estimated = true;
    }
    if (!estOutput && role === 'assistant') {
      estOutput = estimateTokensFromText(contentText || '');
      estimated = true;
    }
  }
  return { inputTokens: estInput, outputTokens: estOutput, estimated };
}

export function normalizeSessionIdFromPath(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  return base
    .replace(/\.(jsonl|json|md|db|settings\.json)$/i, '')
    .replace(/\.deleted\.\d+$/i, '')
    .replace(/\.reset\.\d+$/i, '');
}

export function newMessageId(): string {
  return generateId();
}
