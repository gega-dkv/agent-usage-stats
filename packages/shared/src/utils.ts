import type { TokenTotals, Provider, PricingProvider, NormalizedMessage } from './types.js';
import { PROVIDER_REGISTRY } from './providers.js';

export function computeTotalTokens(totals: Omit<TokenTotals, 'totalTokens'>): number {
  const cached =
    totals.cachedInputTokens ||
    (totals.cacheCreationTokens || 0) + (totals.cacheReadTokens || 0);
  return (
    totals.inputTokens +
    totals.outputTokens +
    cached +
    (totals.toolTokens || 0) +
    totals.reasoningTokens
  );
}

export function emptyTokenTotals(): TokenTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    toolTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

/** Normalize legacy token fields into the expanded TokenTotals shape. */
export function normalizeTokenTotals(totals: Partial<TokenTotals>): TokenTotals {
  const cacheRead = totals.cacheReadTokens ?? totals.cachedInputTokens ?? 0;
  const cacheCreation = totals.cacheCreationTokens ?? 0;
  const cachedInput =
    totals.cachedInputTokens ?? (cacheCreation > 0 || cacheRead > 0 ? cacheCreation + cacheRead : 0);
  const normalized: TokenTotals = {
    inputTokens: totals.inputTokens ?? 0,
    outputTokens: totals.outputTokens ?? 0,
    cachedInputTokens: cachedInput,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead,
    toolTokens: totals.toolTokens ?? 0,
    reasoningTokens: totals.reasoningTokens ?? 0,
    totalTokens: 0,
  };
  normalized.totalTokens = totals.totalTokens ?? computeTotalTokens(normalized);
  return normalized;
}

export function addTokenTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  const merged = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    toolTokens: a.toolTokens + b.toolTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
  return { ...merged, totalTokens: computeTotalTokens(merged) };
}

/** Aggregate per-message token fields into session totals. */
export function totalsFromMessages(messages: Array<Pick<NormalizedMessage, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheCreationTokens' | 'cacheReadTokens' | 'toolTokens' | 'reasoningTokens'>>): TokenTotals {
  const totals = emptyTokenTotals();
  for (const msg of messages) {
    totals.inputTokens += msg.inputTokens || 0;
    totals.outputTokens += msg.outputTokens || 0;
    totals.cacheCreationTokens += msg.cacheCreationTokens || 0;
    totals.cacheReadTokens += msg.cacheReadTokens || msg.cachedInputTokens || 0;
    totals.toolTokens += msg.toolTokens || 0;
    totals.reasoningTokens += msg.reasoningTokens || 0;
  }
  totals.cachedInputTokens = totals.cacheCreationTokens + totals.cacheReadTokens;
  totals.totalTokens = computeTotalTokens(totals);
  return totals;
}

export function providerToPricingProvider(provider: Provider): PricingProvider {
  return PROVIDER_REGISTRY[provider]?.pricingProvider ?? 'other';
}

/**
 * Compact number formatting with k / M / B suffixes — the canonical token
 * format shared by the desktop app, web dashboard, CLI, and charts:
 *   999 → "999", 1_000 → "1k", 1_500 → "1.5k",
 *   1_000_000 → "1M", 1_079_210_000 → "1.08B".
 * Trailing zeros are trimmed (`Number(...)`), so round values read cleanly.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  // Round the mantissa to `decimals`, trimming trailing zeros via Number(...).
  const mantissa = (div: number, decimals: number) => Number((abs / div).toFixed(decimals));

  if (abs >= 1_000_000_000) return `${sign}${mantissa(1_000_000_000, 2)}B`;
  if (abs >= 1_000_000) {
    const m = mantissa(1_000_000, 2);
    // Guard the rounding boundary: 999_999_999 → "1B", not "1000M".
    return m >= 1000 ? `${sign}${mantissa(1_000_000_000, 2)}B` : `${sign}${m}M`;
  }
  if (abs >= 1_000) {
    const m = mantissa(1_000, 1);
    // 999_999 → "1M", not "1000k".
    return m >= 1000 ? `${sign}${mantissa(1_000_000, 2)}M` : `${sign}${m}k`;
  }
  return n.toLocaleString();
}

/**
 * Format a USD amount with exactly two fraction digits, matching the desktop
 * app's currency style (e.g. "$1.23").
 */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function estimateTokensFromText(text: string): number {
  // Rough estimate: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

export function hashFileContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}
