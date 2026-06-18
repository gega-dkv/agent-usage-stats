import type { ModelPricing, TokenTotals, PricingProvider, PricingProfile } from '@agent-usage/shared';
import { DEFAULT_PRICING_MODELS } from './models.js';

export type PricingLookupResult = {
  pricing: ModelPricing | null;
  isEstimated: boolean;
  fallbackModel?: string;
};

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
  } else if (totals.cachedInputTokens > 0) {
    // If cached pricing not available, use input pricing as fallback
    cost += (totals.cachedInputTokens / 1_000_000) * pricing.inputPerMillion;
    isEstimated = true;
  }

  if (totals.reasoningTokens > 0 && pricing.reasoningPerMillion != null) {
    cost += (totals.reasoningTokens / 1_000_000) * pricing.reasoningPerMillion;
  } else if (totals.reasoningTokens > 0) {
    // Reasoning tokens not priced separately, treat as output
    cost += (totals.reasoningTokens / 1_000_000) * pricing.outputPerMillion;
    isEstimated = true;
  }

  return { cost, isEstimated };
}

export function lookupPricing(
  model: string | undefined,
  provider: PricingProvider,
  pricingModels: ModelPricing[],
  profile: PricingProfile = 'api-standard',
): PricingLookupResult {
  if (!model) {
    return {
      pricing: null,
      isEstimated: true,
      fallbackModel: getDefaultFallbackModel(provider),
    };
  }

  // Try exact match first
  const exact = pricingModels.find(
    (p) => p.model === model && p.provider === provider && (p.profile || 'api-standard') === profile,
  );
  if (exact) return { pricing: exact, isEstimated: false };

  // Try model contains match
  const contains = pricingModels.find(
    (p) =>
      p.model.toLowerCase().includes(model.toLowerCase()) &&
      p.provider === provider &&
      (p.profile || 'api-standard') === profile,
  );
  if (contains) return { pricing: contains, isEstimated: false };

  // Try any profile for this model
  const anyProfile = pricingModels.find(
    (p) => p.model === model && p.provider === provider,
  );
  if (anyProfile) return { pricing: anyProfile, isEstimated: false };

  // Fallback to default model for this provider
  const fallback = getDefaultFallbackModel(provider);
  const fallbackPricing = pricingModels.find(
    (p) => p.model === fallback && p.provider === provider,
  );

  return {
    pricing: fallbackPricing || null,
    isEstimated: true,
    fallbackModel: fallback,
  };
}

export function getDefaultFallbackModel(provider: PricingProvider): string {
  const fallbacks: Record<PricingProvider, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    google: 'gemini-2.5-pro',
  };
  return fallbacks[provider];
}

export function getDefaultPricingModels(): ModelPricing[] {
  return DEFAULT_PRICING_MODELS.map((model) => ({ ...model }));
}
