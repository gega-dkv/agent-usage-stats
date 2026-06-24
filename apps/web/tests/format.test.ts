import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatNumber,
  formatCurrency,
  setCurrencyOverride,
  getCurrencyOverride,
  formatPercentDelta,
  formatRelativeTime,
} from '../src/lib/format';

describe('format helpers', () => {
  describe('formatNumber', () => {
    it('formats billions', () => {
      expect(formatNumber(1_079_210_000)).toBe('1.08B');
    });
    it('formats millions', () => {
      expect(formatNumber(1_500_000)).toBe('1.5M');
    });
    it('formats thousands with a lowercase k', () => {
      expect(formatNumber(2500)).toBe('2.5k');
    });
    it('trims trailing zeros and formats small numbers', () => {
      expect(formatNumber(1234)).toBe('1.2k');
      expect(formatNumber(999)).toBe('999');
    });
    it('handles non-finite values', () => {
      expect(formatNumber(Number.NaN)).toBe('0');
      expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('0');
    });
  });

  describe('formatCurrency', () => {
    beforeEach(() => {
      setCurrencyOverride('USD');
    });

    it('defaults to USD', () => {
      expect(formatCurrency(12.5)).toContain('12.50');
    });

    it('respects an explicit currency override', () => {
      setCurrencyOverride('EUR');
      const out = formatCurrency(10);
      // EUR uses de-DE locale → comma decimal separator.
      expect(out).toMatch(/10,00/);
    });

    it('accepts an explicit currency argument', () => {
      expect(formatCurrency(5, 'GBP')).toContain('5.00');
    });

    it('falls back gracefully for an unknown currency', () => {
      const out = formatCurrency(5, 'XYZ');
      expect(out).toContain('XYZ');
    });

    it('uses zero decimals for JPY', () => {
      const out = formatCurrency(1000, 'JPY');
      // JPY has no fractional digits.
      expect(out).not.toContain('.');
    });
  });

  describe('currency override', () => {
    it('round-trips the override', () => {
      setCurrencyOverride('GBP');
      expect(getCurrencyOverride()).toBe('GBP');
    });

    it('ignores invalid codes', () => {
      setCurrencyOverride('not-a-code');
      expect(getCurrencyOverride()).toBe('GBP');
    });
  });

  describe('formatPercentDelta', () => {
    it('shows a positive delta', () => {
      const r = formatPercentDelta(120, 100);
      expect(r.positive).toBe(true);
      expect(r.value).toBe('+20%');
    });

    it('shows a negative delta', () => {
      const r = formatPercentDelta(80, 100);
      expect(r.positive).toBe(false);
      expect(r.value).toBe('-20%');
    });

    it('handles a zero previous value', () => {
      const r = formatPercentDelta(50, 0);
      expect(r.positive).toBe(true);
      expect(r.value).toBe('+∞');
    });

    it('handles both zero', () => {
      const r = formatPercentDelta(0, 0);
      expect(r.value).toBe('0%');
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "never" for undefined', () => {
      expect(formatRelativeTime(undefined)).toBe('never');
    });

    it('returns "just now" for the present moment', () => {
      expect(formatRelativeTime(new Date().toISOString())).toBe('just now');
    });

    it('returns minutes for a recent past time', () => {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      expect(formatRelativeTime(twoMinutesAgo)).toBe('2m ago');
    });

    it('returns hours', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(threeHoursAgo)).toBe('3h ago');
    });

    it('returns days', () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(fiveDaysAgo)).toBe('5d ago');
    });
  });
});
