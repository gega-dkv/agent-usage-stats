import { describe, it, expect } from 'vitest';
import {
  calculateCost,
  lookupPricing,
  getDefaultFallbackModel,
  getDefaultPricingModels,
  resolveModelAlias,
  stripProviderPrefix,
  mergeModelAliases,
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

      expect(cost).toBe(2.5 + 5);
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

      expect(cost).toBe(0.5 * 2.5 + 0.2 * 10 + 0.3 * 1.25);
      expect(isEstimated).toBe(false);
    });

    it('should include reasoning cost when a dedicated rate exists', () => {
      const totals: TokenTotals = {
        inputTokens: 100000,
        outputTokens: 50000,
        cachedInputTokens: 0,
        reasoningTokens: 100000,
        totalTokens: 250000,
      };

      const { cost, isEstimated } = calculateCost(totals, mockPricing);

      expect(cost).toBe(0.1 * 2.5 + 0.05 * 10 + 0.1 * 15);
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

    it('should use output pricing for reasoning without marking estimated', () => {
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

      const { cost, isEstimated } = calculateCost(totals, pricingNoReasoning);
      expect(cost).toBe(0.1 * 2.5 + 0.05 * 10 + 0.03 * 10);
      expect(isEstimated).toBe(false);
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
      const result = lookupPricing('unknown-model-xyz', 'openai', getDefaultPricingModels());

      expect(result.isEstimated).toBe(true);
      expect(result.fallbackModel).toBe('gpt-4o');
      expect(result.pricing?.model).toBe('gpt-4o');
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
      const result = lookupPricing('gemini-2.5-pro', 'google', getDefaultPricingModels());

      expect(result.pricing).not.toBeNull();
      expect(result.pricing?.provider).toBe('google');
    });
  });

  describe('alias resolution', () => {
    const models = getDefaultPricingModels();

    it('resolves OpenAI chatgpt and dated snapshot aliases', () => {
      expect(lookupPricing('chatgpt-4o-latest', 'openai', models).pricing?.model).toBe('gpt-4o');
      expect(lookupPricing('gpt-4o-2024-08-06', 'openai', models).pricing?.model).toBe('gpt-4o');
      expect(lookupPricing('chatgpt-4o-mini', 'openai', models).pricing?.model).toBe('gpt-4o-mini');
      expect(lookupPricing('o1-preview', 'openai', models).pricing?.model).toBe('o1');
      expect(lookupPricing('o3-mini', 'openai', models).pricing?.model).toBe('o3-mini');
    });

    it('resolves Anthropic shorthand and dated aliases', () => {
      expect(
        lookupPricing('claude-sonnet-4', 'anthropic', models).pricing?.model,
      ).toBe('claude-sonnet-4-20250514');
      expect(
        lookupPricing('claude-3-5-sonnet-latest', 'anthropic', models).pricing?.model,
      ).toBe('claude-3-5-sonnet-20241022');
      expect(
        lookupPricing('claude-opus-4-1', 'anthropic', models).pricing?.model,
      ).toBe('claude-opus-4-1-20250805');
    });

    it('resolves Gemini, Vertex, and OpenRouter Gemini aliases', () => {
      expect(lookupPricing('gemini-pro', 'google', models).pricing?.model).toBe('gemini-2.5-pro');
      expect(lookupPricing('models/gemini-2.5-pro', 'google', models).pricing?.model).toBe(
        'gemini-2.5-pro',
      );
      expect(
        lookupPricing('openrouter/google/gemini-2.5-flash', 'google', models).pricing?.model,
      ).toBe('gemini-2.5-flash');
      expect(
        lookupPricing('gemini-2.5-pro-preview-05-06', 'google', models).pricing?.model,
      ).toBe('gemini-2.5-pro');
    });

    it('resolves Qwen aliases', () => {
      expect(lookupPricing('qwen2.5-72b-instruct', 'qwen', models).pricing?.model).toBe('qwen-plus');
      expect(lookupPricing('qwen3-coder', 'qwen', models).pricing?.model).toBe('qwen-max');
      expect(lookupPricing('qwen-turbo-latest', 'qwen', models).pricing?.model).toBe('qwen-turbo');
    });

    it('resolves Moonshot and Kimi aliases', () => {
      expect(lookupPricing('kimi-latest', 'moonshot', models).pricing?.model).toBe(
        'moonshot-v1-128k',
      );
      expect(lookupPricing('moonshot-v1-32k', 'moonshot', models).pricing?.model).toBe(
        'moonshot-v1-128k',
      );
      expect(lookupPricing('kimi-k2', 'other', models).pricing?.model).toBe('moonshot-v1-128k');
    });

    it('resolves provider-prefixed model names', () => {
      expect(
        lookupPricing('anthropic/claude-3-5-sonnet-20241022', 'other', models).pricing?.model,
      ).toBe('claude-3-5-sonnet-20241022');
      expect(
        lookupPricing('openrouter/anthropic/claude-sonnet-4', 'other', models).pricing?.model,
      ).toBe('claude-sonnet-4-20250514');
      expect(lookupPricing('openai/gpt-4o', 'other', models).pricing?.model).toBe('gpt-4o');
    });

    it('applies custom config aliases over bundled defaults', () => {
      const result = lookupPricing('team-codename', 'openai', models, 'api-standard', {
        'team-codename': 'gpt-4o-mini',
      });

      expect(result.pricing?.model).toBe('gpt-4o-mini');
      expect(result.isEstimated).toBe(false);
    });

    it('falls back with isEstimated for unknown aliased providers', () => {
      const result = lookupPricing('totally-unknown-model', 'qwen', models);
      expect(result.isEstimated).toBe(true);
      expect(result.fallbackModel).toBe('qwen-plus');
      expect(result.pricing?.model).toBe('qwen-plus');
    });
  });

  describe('stripProviderPrefix', () => {
    it('strips nested openrouter and provider prefixes', () => {
      expect(stripProviderPrefix('openrouter/anthropic/claude-sonnet-4')).toEqual({
        model: 'claude-sonnet-4',
        prefixProvider: 'anthropic',
      });
      expect(stripProviderPrefix('google/gemini-2.5-pro')).toEqual({
        model: 'gemini-2.5-pro',
        prefixProvider: 'google',
      });
    });
  });

  describe('mergeModelAliases', () => {
    it('merges custom aliases without dropping defaults', () => {
      const merged = mergeModelAliases({ 'custom-alias': 'gpt-4.1' });
      expect(merged['custom-alias']).toBe('gpt-4.1');
      expect(merged['chatgpt-4o']).toBe('gpt-4o');
    });
  });

  describe('resolveModelAlias', () => {
    it('supports provider override objects', () => {
      const resolved = resolveModelAlias('shared-alias', 'openai', {
        'shared-alias': { target: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      });
      expect(resolved.model).toBe('claude-sonnet-4-20250514');
      expect(resolved.provider).toBe('anthropic');
    });
  });

  describe('getDefaultFallbackModel', () => {
    it('should return correct fallbacks', () => {
      expect(getDefaultFallbackModel('openai')).toBe('gpt-4o');
      expect(getDefaultFallbackModel('anthropic')).toBe('claude-sonnet-4-20250514');
      expect(getDefaultFallbackModel('google')).toBe('gemini-2.5-pro');
      expect(getDefaultFallbackModel('qwen')).toBe('qwen-plus');
      expect(getDefaultFallbackModel('moonshot')).toBe('moonshot-v1-128k');
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
      expect(providers.has('qwen')).toBe(true);
      expect(providers.has('moonshot')).toBe(true);
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
