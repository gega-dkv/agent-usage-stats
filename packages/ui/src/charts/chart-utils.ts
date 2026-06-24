import { formatNumber } from '@agent-usage/shared';

/**
 * Compact number formatting for chart axes and tooltips. Reuses the canonical
 * token format (k / M / B) so axes match the stat cards and tables; sub-1000
 * tick values are rounded to keep axis labels clean.
 */
export function shortNumber(n: number): string {
  if (Math.abs(n) < 1_000) return Math.round(n).toLocaleString();
  return formatNumber(n);
}

export const CHART_COLORS = [
  'hsl(217, 91%, 60%)',
  'hsl(160, 84%, 39%)',
  'hsl(38, 92%, 50%)',
  'hsl(280, 65%, 60%)',
  'hsl(340, 82%, 52%)',
];

export const DEFAULT_LINE_COLOR = 'hsl(217, 91%, 60%)';
