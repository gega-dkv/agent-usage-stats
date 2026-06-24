import { describe, it, expect } from 'vitest';
import { shortNumber, CHART_COLORS } from '../src/charts/chart-utils.js';

describe('chart utils', () => {
  it('shortNumber formats compact values', () => {
    expect(shortNumber(42)).toBe('42');
    expect(shortNumber(1500)).toBe('1.5k');
    expect(shortNumber(2_500_000)).toBe('2.5M');
  });

  it('CHART_COLORS provides a non-empty palette', () => {
    expect(CHART_COLORS.length).toBeGreaterThan(0);
    expect(CHART_COLORS[0]).toMatch(/^hsl\(/);
  });
});
