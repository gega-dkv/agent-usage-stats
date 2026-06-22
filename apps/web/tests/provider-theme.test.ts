import { describe, it, expect } from 'vitest';
import { providerTheme, providerHsl, labelHue, labelHsl, providerTriplet } from '../src/lib/provider-theme';
import { listProviderIds } from '@agent-usage/shared';

describe('provider-theme', () => {
  describe('providerTheme', () => {
    it('returns a theme for every registered provider', () => {
      const ids = listProviderIds();
      expect(ids.length).toBeGreaterThanOrEqual(19);
      for (const id of ids) {
        const theme = providerTheme(id);
        expect(theme.hue).toBeGreaterThanOrEqual(0);
        expect(theme.hue).toBeLessThan(360);
        expect(theme.gradient).toMatch(/^from-/);
        expect(theme.solid).toMatch(/^\d+ 70% 55%$/);
        expect(theme.badgeStyle).toHaveProperty('backgroundColor');
        expect(theme.badgeStyle).toHaveProperty('color');
      }
    });

    it('returns a stable theme for the same provider', () => {
      expect(providerTheme('claude')).toEqual(providerTheme('claude'));
    });

    it('never throws for an unknown provider id', () => {
      const theme = providerTheme('some-unknown-provider-xyz');
      expect(theme.hue).toBeGreaterThanOrEqual(0);
      expect(theme.gradient).toMatch(/^from-/);
    });

    it('assigns distinct hues to the tier-1 providers', () => {
      const tier1 = ['claude', 'codex', 'gemini', 'qwen', 'goose'] as const;
      const hues = tier1.map((id) => providerTheme(id).hue);
      const unique = new Set(hues);
      // At least 4 of 5 should be distinct (manual hues are spread).
      expect(unique.size).toBeGreaterThanOrEqual(4);
    });
  });

  describe('providerHsl', () => {
    it('returns a valid hsl() string', () => {
      const hsl = providerHsl('claude');
      expect(hsl).toMatch(/^hsl\(\d+ 70% 55%\)$/);
    });

    it('respects lightness override', () => {
      const hsl = providerHsl('claude', 40);
      expect(hsl).toContain('40%');
    });
  });

  describe('providerTriplet', () => {
    it('returns an hsl triplet without the hsl() wrapper', () => {
      const triplet = providerTriplet('claude');
      expect(triplet).toMatch(/^\d+ 70% 55%$/);
    });
  });

  describe('labelHue / labelHsl', () => {
    it('returns a stable hue for the same label', () => {
      expect(labelHue('gpt-4o')).toBe(labelHue('gpt-4o'));
    });

    it('returns a valid hsl string', () => {
      expect(labelHsl('my-project')).toMatch(/^hsl\(\d+ 70% 55%\)$/);
    });
  });
});
