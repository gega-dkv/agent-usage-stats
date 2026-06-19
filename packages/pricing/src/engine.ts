import type { ModelPricing, ModelAliasMap, TokenTotals, PricingProvider, PricingProfile } from '@agent-usage/shared';
import { DEFAULT_PRICING_MODELS } from './models.js';
import { mergeModelAliases, resolveModelAlias } from './aliases.js';

export type PricingLookupResult = {
  pricing: ModelPricing | null;
  isEstimated: boolean;
  fallbackModel?: string;
  resolvedModel?: string;
  resolvedProvider?: PricingProvider;
};

/**
 * Pricing profiles:
 * - `api-standard` — default on-demand API rates (bundled snapshot).
 * - `api-batch` — batch API discounted rates (typically cloned from api-standard).
 * - `subscription-equivalent` — flat monthly-equivalent per-token rates for comparing
 *   usage against subscription products (ChatGPT Plus, Claude Pro, etc.). These are
 *   not API list prices; clone or edit the profile to match your subscription tier.
 * - `custom` — user-defined profile for any scenario.
 *
 * Pricing is always loaded from the local DB or bundled defaults — never fetched remotely
 * unless a future explicit opt-in is added.
 */
export function calculateCost(
  totals: TokenTotals,
  pricing: ModelPricing,
): { cost: number; isEstimated: boolean } {
  let cost = 0;
  let isEstimated = false;

  cost += (totals.inputTokens / 1_000_000) * pricing.inputPerMillion;
  cost += (totals.outputTokens / 1_000_000) * pricing.outputPerMillion;

  if (totals.cachedInputTokens > 0 && pricing.cachedInputPerMillion != null) {
    cost += (totals.cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion;
  } else if (totals.cacheReadTokens > 0 && pricing.cachedInputPerMillion != null) {
    cost += (totals.cacheReadTokens / 1_000_000) * pricing.cachedInputPerMillion;
  } else if (totals.cachedInputTokens > 0 || totals.cacheReadTokens > 0) {
    const cached = totals.cachedInputTokens || totals.cacheReadTokens;
    cost += (cached / 1_000_000) * pricing.inputPerMillion;
    isEstimated = true;
  }

  if (totals.cacheCreationTokens > 0 && pricing.cacheWritePerMillion != null) {
    cost += (totals.cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;
  } else if (totals.cacheCreationTokens > 0) {
    cost += (totals.cacheCreationTokens / 1_000_000) * pricing.inputPerMillion;
    isEstimated = true;
  }

  if (totals.reasoningTokens > 0 && pricing.reasoningPerMillion != null) {
    cost += (totals.reasoningTokens / 1_000_000) * pricing.reasoningPerMillion;
  } else if (totals.reasoningTokens > 0) {
    // Reasoning tokens default to output-side pricing when no dedicated rate exists.
    cost += (totals.reasoningTokens / 1_000_000) * pricing.outputPerMillion;
  }

  return { cost, isEstimated };
}

export function lookupPricing(
  model: string | undefined,
  provider: PricingProvider,
  pricingModels: ModelPricing[],
  profile: PricingProfile = 'api-standard',
  aliases?: ModelAliasMap,
): PricingLookupResult {
  if (!model) {
    return {
      pricing: null,
      isEstimated: true,
      fallbackModel: getDefaultFallbackModel(provider),
    };
  }

  const mergedAliases = mergeModelAliases(aliases);
  const resolved = resolveModelAlias(model, provider, mergedAliases);
  const effectiveProvider = resolved.provider;
  const resolvedModel = resolved.model;

  const exact = pricingModels.find(
    (p) =>
      p.model === resolvedModel &&
      p.provider === effectiveProvider &&
      (p.profile || 'api-standard') === profile,
  );
  if (exact) {
    return {
      pricing: exact,
      isEstimated: false,
      resolvedModel,
      resolvedProvider: effectiveProvider,
    };
  }

  const contains = pricingModels.find(
    (p) =>
      p.model.toLowerCase().includes(resolvedModel.toLowerCase()) &&
      p.provider === effectiveProvider &&
      (p.profile || 'api-standard') === profile,
  );
  if (contains) {
    return {
      pricing: contains,
      isEstimated: false,
      resolvedModel,
      resolvedProvider: effectiveProvider,
    };
  }

  const anyProfile = pricingModels.find(
    (p) => p.model === resolvedModel && p.provider === effectiveProvider,
  );
  if (anyProfile) {
    return {
      pricing: anyProfile,
      isEstimated: false,
      resolvedModel,
      resolvedProvider: effectiveProvider,
    };
  }

  const fallback = getDefaultFallbackModel(effectiveProvider);
  const fallbackPricing = fallback
    ? pricingModels.find((p) => p.model === fallback && p.provider === effectiveProvider)
    : undefined;

  return {
    pricing: fallbackPricing || null,
    isEstimated: true,
    fallbackModel: fallback,
    resolvedModel,
    resolvedProvider: effectiveProvider,
  };
}

export function getDefaultFallbackModel(provider: PricingProvider): string | undefined {
  const fallbacks: Partial<Record<PricingProvider, string>> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    google: 'gemini-2.5-pro',
    qwen: 'qwen-plus',
    moonshot: 'moonshot-v1-128k',
  };
  return fallbacks[provider];
}

export function getDefaultPricingModels(): ModelPricing[] {
  return DEFAULT_PRICING_MODELS.map((model) => ({ ...model }));
}

export { mergeModelAliases, resolveModelAlias, stripProviderPrefix, DEFAULT_MODEL_ALIASES } from './aliases.js';
