import fs from 'fs';
import path from 'path';
import type {
  ProviderParser,
  ParseResult,
  ParseOptions,
  NormalizedMessage,
} from '@agent-usage/shared';
import {
  buildSession,
  fileReadWarning,
  normalizeSessionIdFromPath,
  newMessageId,
} from './parser-helpers.js';

/**
 * Grok keeps a per-session "signals.json" under the ~/.grok/sessions tree. Each
 * file exposes aggregate context-window statistics, not per-message usage:
 *
 *   - totalTokensBeforeCompaction: tokens accumulated before the session was
 *     compacted (i.e. prior conversation context).
 *   - contextTokensUsed: tokens consumed by the current context window.
 *
 * There is no input/output split and no cost data, so we aggregate both fields
 * into a single assistant usage message. Ports GrokLocalSessionScanner.summarize
 * from scanner.md (file-at-a-time variant of this repo's parse contract).
 *
 * Lookback window (default 30 days) is normally applied at discovery/scan time;
 * here we still respect the file's mtime so stale signals.json files passed
 * directly to parse don't surface ancient sessions.
 */
const DEFAULT_LOOKBACK_DAYS = 30;

type GrokSignals = {
  totalTokensBeforeCompaction?: number | string;
  contextTokensUsed?: number | string;
  primaryModelId?: string;
  modelsUsed?: unknown;
  [key: string]: unknown;
};

export const grokParser: ProviderParser = {
  provider: 'grok',

  canParse(filePath: string, sample: string): boolean {
    // Prefer to match files literally named signals.json under a .grok tree;
    // fall back to a content sniff for the signal fields.
    const lower = filePath.toLowerCase();
    if (lower.endsWith('signals.json') && lower.includes('.grok')) return true;
    if (lower.endsWith('signals.json')) {
      try {
        const data = JSON.parse(sample) as GrokSignals;
        return (
          'totalTokensBeforeCompaction' in data ||
          'contextTokensUsed' in data ||
          typeof data.primaryModelId === 'string'
        );
      } catch {
        return false;
      }
    }
    return false;
  },

  async parse(filePath: string, _options?: ParseOptions): Promise<ParseResult> {
    const warnings: ParseResult['warnings'] = [];

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      warnings.push(fileReadWarning(filePath, e));
      return { sessions: [], warnings };
    }

    // Respect the lookback window so manually-scanned stale files don't surface.
    const lookbackDays = DEFAULT_LOOKBACK_DAYS;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    if (stat.mtime < cutoff) {
      warnings.push({
        file: filePath,
        message: `Grok signals.json skipped: mtime ${stat.mtime.toISOString()} is older than ${lookbackDays} days`,
        severity: 'warning',
        code: 'detected-only',
      });
      return { sessions: [], warnings };
    }

    let data: GrokSignals;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as GrokSignals;
    } catch (e) {
      warnings.push({
        file: filePath,
        message: `Failed to parse Grok signals.json: ${e instanceof Error ? e.message : String(e)}`,
        severity: 'error',
        code: 'json-parse-error',
      });
      return { sessions: [], warnings };
    }

    const beforeCompaction = toInt(data.totalTokensBeforeCompaction);
    const contextUsed = toInt(data.contextTokensUsed);
    const totalTokens = beforeCompaction + contextUsed;

    const models = collectGrokModels(data);
    const primaryModel = models[0];

    const sessionId = normalizeSessionIdFromPath(filePath);
    const message: NormalizedMessage = {
      id: newMessageId(),
      sessionId,
      timestamp: stat.mtime.toISOString(),
      role: 'assistant',
      model: primaryModel,
      contentPreview: '[grok context-window stats]',
      // Grok exposes no input/output split; record the aggregate as input tokens
      // so totals flow through to rollups. No cached/reasoning fields available.
      inputTokens: totalTokens || undefined,
      metadata: {
        provider: 'grok',
        totalTokensBeforeCompaction: beforeCompaction,
        contextTokensUsed: contextUsed,
        modelsUsed: models,
        ...(primaryModel ? { primaryModelId: primaryModel } : {}),
        fileMtime: stat.mtime.toISOString(),
      },
      usageConfidence: 'metadata-only',
    };

    const session = buildSession(sessionId, 'grok', [message], {
      sourcePath: filePath,
      storageKind: 'json',
      supportLevel: 'prompt-history-only',
      usageConfidence: 'metadata-only',
      projectPath: path.dirname(filePath),
      projectName: path.basename(path.dirname(filePath)),
      startedAt: stat.mtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      tokenUsageEstimated: true,
    });

    return { sessions: [session], warnings };
  },
};

/** Collect model ids, ranked by frequency (primaryModelId counts first). */
function collectGrokModels(data: GrokSignals): string[] {
  const counts = new Map<string, number>();
  const primary = typeof data.primaryModelId === 'string' ? data.primaryModelId.trim() : '';
  if (primary) counts.set(primary, (counts.get(primary) ?? 0) + 1);
  if (Array.isArray(data.modelsUsed)) {
    for (const m of data.modelsUsed) {
      const trimmed = typeof m === 'string' ? m.trim() : '';
      if (trimmed) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/** Round arbitrary JSON values to non-negative integers (ports scanner.md toInt). */
function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
  if (value && typeof value === 'object' && 'valueOf' in value) {
    const n = Number((value as { valueOf(): number }).valueOf());
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }
  return 0;
}
