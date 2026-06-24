import { providerTheme, providerHsl } from './provider-theme';

// Re-export so existing imports of providerLabel from format keep working.
export { providerLabel } from './provider-theme';

// Single source of truth for the compact token format (k / M / B), shared with
// the CLI, charts, and the desktop app.
export { formatNumber } from '@agent-usage/shared';

/**
 * Format a number as a currency string. Currency defaults to USD but can be
 * overridden per-call (e.g. from the configured settings currency). We keep a
 * module-level override so legacy callers without a currency arg still respect
 * the user's configured currency once `setCurrencyOverride` is called.
 */
let currencyOverride = 'USD';

export function setCurrencyOverride(currency: string): void {
  if (currency && currency.length === 3) currencyOverride = currency.toUpperCase();
}

export function getCurrencyOverride(): string {
  return currencyOverride;
}

const CURRENCY_LOCALE: Record<string, string> = {
  USD: 'en-US',
  EUR: 'de-DE',
  GBP: 'en-GB',
  JPY: 'ja-JP',
  CAD: 'en-CA',
  AUD: 'en-AU',
};

export function formatCurrency(n: number, currency?: string): string {
  const cur = (currency || currencyOverride).toUpperCase();
  const frac = cur === 'JPY' ? 0 : 2;
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALE[cur] ?? 'en-US', {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).format(n);
  } catch {
    // Fallback if Intl doesn't recognize the currency code.
    return `${cur} ${n.toFixed(2)}`;
  }
}

export function formatDate(iso?: string): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return 'N/A';
  }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return 'N/A';
  }
}

/** Relative time like "2m ago", "3h ago", "5d ago". */
export function formatRelativeTime(iso?: string): string {
  if (!iso) return 'never';
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = Math.max(0, now - then);
    const sec = Math.round(diff / 1000);
    if (sec < 60) return 'just now';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.round(hr / 24);
    if (day < 30) return `${day}d ago`;
    const mo = Math.round(day / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.round(mo / 12)}y ago`;
  } catch {
    return 'never';
  }
}

/**
 * Tailwind gradient classes for a provider (stat cards, icon chips).
 * Delegates to the unified provider-theme map.
 */
export function providerColor(provider: string): string {
  return providerTheme(provider).gradient;
}

/** hsl() string for a provider, used in SVG charts. */
export function providerSolidColor(provider: string, lightness = 55): string {
  return providerHsl(provider, lightness);
}

/**
 * Legacy badge className shim — returns a stable badge class string.
 * Prefer the `<ProviderBadge>` component for new code, which uses inline
 * styles derived from the provider hue (more accurate colors, full coverage).
 */
export function providerBadge(provider: string): string {
  return providerTheme(provider).gradient;
}

/**
 * Percent-change formatter for trend deltas.
 * Returns a signed, rounded percentage, e.g. "+12%" / "-3%".
 */
export function formatPercentDelta(current: number, previous: number): { value: string; positive: boolean } {
  if (!previous || previous === 0) {
    return current > 0 ? { value: '+∞', positive: true } : { value: '0%', positive: true };
  }
  const delta = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(delta));
  return {
    value: `${delta >= 0 ? '+' : '-'}${rounded}%`,
    positive: delta >= 0,
  };
}
