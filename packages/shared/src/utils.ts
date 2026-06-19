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

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
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
