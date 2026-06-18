import { describe, it, expect } from 'vitest';
import {
  calculateCost,
  lookupPricing,
  getDefaultFallbackModel,
  getDefaultPricingModels,
} from '../src/engine.js';
import type { TokenTotals, ModelPricing } from '@agent-usage/shared';

describe('Pricing Engine', () => {
  const mockPricing: ModelPricing = {
    provider: 'openai',
    model: 'gpt-4o',
    currency: 'USD',
    inputPerMillion: 2.5,
    outputPerMillion: 10,
    cachedInputPerMillion: 1.25,
    reasoningPerMillion: 15,
  };

  describe('calculateCost', () => {
    it('should calculate basic cost correctly', () => {
      const totals: TokenTotals = {
        inputTokens: 1000000,
        outputTokens: 500000,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 1500000,
      };

      const { cost, isEstimated } = calculateCost(totals, mockPricing);

      expect(cost).toBe(2.5 + 5); // 1M input * 2.5 + 0.5M output * 10
      expect(isEstimated).toBe(false);
    });

    it('should include cached input cost', () => {
      const totals: TokenTotals = {
        inputTokens: 500000,
        outputTokens: 200000,
        cachedInputTokens: 300000,
        reasoningTokens: 0,
        totalTokens: 1000000,
      };

      const { cost, isEstimated } = calculateCost(totals, mockPricing);

      expect(cost).toBe(
        0.5 * 2.5 + 0.2 * 10 + 0.3 * 1.25,
      );
      expect(isEstimated).toBe(false);
    });

    it('should include reasoning cost', () => {
      const totals: TokenTotals = {
        inputTokens: 100000,
        outputTokens: 50000,
        cachedInputTokens: 0,
        reasoningTokens: 100000,
        totalTokens: 250000,
      };

      const { cost, isEstimated } = calculateCost(totals, mockPricing);

      expect(cost).toBe(
        0.1 * 2.5 + 0.05 * 10 + 0.1 * 15,
      );
      expect(isEstimated).toBe(false);
    });

    it('should mark as estimated when cached pricing missing', () => {
      const pricingNoCache: ModelPricing = {
        ...mockPricing,
        cachedInputPerMillion: undefined,
      };

      const totals: TokenTotals = {
        inputTokens: 100000,
        outputTokens: 50000,
        cachedInputTokens: 30000,
        reasoningTokens: 0,
        totalTokens: 180000,
      };

      const { isEstimated } = calculateCost(totals, pricingNoCache);
      expect(isEstimated).toBe(true);
    });

    it('should mark as estimated when reasoning pricing missing', () => {
      const pricingNoReasoning: ModelPricing = {
        ...mockPricing,
        reasoningPerMillion: undefined,
      };

      const totals: TokenTotals = {
        inputTokens: 100000,
        outputTokens: 50000,
        cachedInputTokens: 0,
        reasoningTokens: 30000,
        totalTokens: 180000,
      };

      const { isEstimated } = calculateCost(totals, pricingNoReasoning);
      expect(isEstimated).toBe(true);
    });
  });

  describe('lookupPricing', () => {
    it('should find exact model match', () => {
      const result = lookupPricing('gpt-4o', 'openai', getDefaultPricingModels());

      expect(result.pricing).not.toBeNull();
      expect(result.pricing?.model).toBe('gpt-4o');
      expect(result.isEstimated).toBe(false);
    });

    it('should fallback to default model when unknown', () => {
      const result = lookupPricing('unknown-model', 'openai', getDefaultPricingModels());

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackModel).toBe('gpt-4o');
    });

    it('should return fallback for missing model', () => {
      const result = lookupPricing(undefined, 'openai', getDefaultPricingModels());

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackModel).toBe('gpt-4o');
    });

    it('should match Claude models', () => {
      const result = lookupPricing(
        'claude-sonnet-4-20250514',
        'anthropic',
        getDefaultPricingModels(),
      );

      expect(result.pricing).not.toBeNull();
      expect(result.pricing?.provider).toBe('anthropic');
    });

    it('should match Gemini models', () => {
      const result = lookupPricing(
        'gemini-2.5-pro',
        'google',
        getDefaultPricingModels(),
      );

      expect(result.pricing).not.toBeNull();
      expect(result.pricing?.provider).toBe('google');
    });
  });

  describe('getDefaultFallbackModel', () => {
    it('should return correct fallbacks', () => {
      expect(getDefaultFallbackModel('openai')).toBe('gpt-4o');
      expect(getDefaultFallbackModel('anthropic')).toBe('claude-sonnet-4-20250514');
      expect(getDefaultFallbackModel('google')).toBe('gemini-2.5-pro');
    });
  });

  describe('getDefaultPricingModels', () => {
    it('should return a non-empty array', () => {
      const models = getDefaultPricingModels();
      expect(models.length).toBeGreaterThan(0);
    });

    it('should include all providers', () => {
      const models = getDefaultPricingModels();
      const providers = new Set(models.map((m) => m.provider));
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('anthropic')).toBe(true);
      expect(providers.has('google')).toBe(true);
    });

    it('should have valid pricing values', () => {
      const models = getDefaultPricingModels();
      for (const model of models) {
        expect(model.inputPerMillion).toBeGreaterThanOrEqual(0);
        expect(model.outputPerMillion).toBeGreaterThanOrEqual(0);
        expect(model.currency).toBe('USD');
      }
    });
  });
});
