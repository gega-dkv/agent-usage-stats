import { describe, it, expect } from 'vitest';
import {
  computeTotalTokens,
  emptyTokenTotals,
  addTokenTotals,
  providerToPricingProvider,
  formatNumber,
  formatCurrency,
  generateId,
  truncateText,
  estimateTokensFromText,
} from '../src/utils.js';

describe('Shared Utils', () => {
  describe('computeTotalTokens', () => {
    it('should compute total tokens correctly', () => {
      const totals = {
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 30,
        reasoningTokens: 20,
      };

      expect(computeTotalTokens(totals)).toBe(200);
    });

    it('should handle zero values', () => {
      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      };

      expect(computeTotalTokens(totals)).toBe(0);
    });
  });

  describe('emptyTokenTotals', () => {
    it('should return all zeros', () => {
      const totals = emptyTokenTotals();
      expect(totals.inputTokens).toBe(0);
      expect(totals.outputTokens).toBe(0);
      expect(totals.cachedInputTokens).toBe(0);
      expect(totals.reasoningTokens).toBe(0);
      expect(totals.totalTokens).toBe(0);
    });
  });

  describe('addTokenTotals', () => {
    it('should add token totals correctly', () => {
      const a = {
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 30,
        reasoningTokens: 20,
        totalTokens: 200,
      };

      const b = {
        inputTokens: 200,
        outputTokens: 100,
        cachedInputTokens: 60,
        reasoningTokens: 40,
        totalTokens: 400,
      };

      const result = addTokenTotals(a, b);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.cachedInputTokens).toBe(90);
      expect(result.reasoningTokens).toBe(60);
      expect(result.totalTokens).toBe(600);
    });
  });

  describe('providerToPricingProvider', () => {
    it('should map providers correctly', () => {
      expect(providerToPricingProvider('codex')).toBe('openai');
      expect(providerToPricingProvider('claude')).toBe('anthropic');
      expect(providerToPricingProvider('gemini')).toBe('google');
    });
  });

  describe('formatNumber', () => {
    it('should format billions', () => {
      expect(formatNumber(1079210000)).toBe('1.08B');
    });

    it('should format millions', () => {
      expect(formatNumber(1500000)).toBe('1.5M');
    });

    it('should format thousands with a lowercase k', () => {
      expect(formatNumber(1500)).toBe('1.5k');
      expect(formatNumber(1000)).toBe('1k');
    });

    it('should trim trailing zeros and format small numbers', () => {
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(999)).toBe('999');
    });

    it('should guard rounding boundaries', () => {
      expect(formatNumber(999999)).toBe('1M');
      expect(formatNumber(999999999)).toBe('1B');
    });

    it('should handle negatives and non-finite values', () => {
      expect(formatNumber(-2500)).toBe('-2.5k');
      expect(formatNumber(NaN)).toBe('0');
    });
  });

  describe('formatCurrency', () => {
    it('should format currency with exactly two decimals', () => {
      expect(formatCurrency(12.34)).toBe('$12.34');
      expect(formatCurrency(0.1234)).toBe('$0.12');
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('truncateText', () => {
    it('should not truncate short text', () => {
      expect(truncateText('hello', 10)).toBe('hello');
    });

    it('should truncate long text', () => {
      expect(truncateText('hello world', 5)).toBe('he...');
    });
  });

  describe('estimateTokensFromText', () => {
    it('should estimate tokens from text', () => {
      const text = 'This is a test sentence with some words.';
      const tokens = estimateTokensFromText(text);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length);
    });
  });
});
