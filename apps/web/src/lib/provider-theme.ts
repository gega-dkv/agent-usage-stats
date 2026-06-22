import type { CSSProperties } from 'react';
import { getProviderDefinition } from '@agent-usage/shared';

/**
 * Complete provider color system — single source of truth for how every
 * provider looks across charts, badges, donut slices, cards, and dots.
 *
 * 19 providers get distinct hues via a golden-angle distribution (~47.37°)
 * which spreads colors perceptually across the hue wheel. Each provider maps
 * to a {hue, gradient, solid, soft, text, dot} tuple so badges/charts/cards
 * all draw from the same source instead of being hardcoded in 5 places.
 *
 * Registry is the source of truth for which providers exist; this module only
 * assigns them stable visual identity. New providers fall back to a computed
 * hue derived from their id hash so they're never uncolored.
 */

export type ProviderTheme = {
  /** Hue 0-360 for direct hsl() use in charts. */
  hue: number;
  /** Tailwind gradient classes, e.g. "from-orange-500 to-amber-500". */
  gradient: string;
  /** Raw hsl triplet string for SVG fills, e.g. "27 70% 55%". */
  solid: string;
  /** Inline style object for soft badges (bg/text/border driven by hue). */
  badgeStyle: CSSProperties;
  /** Inline color string for text elements using this provider's hue. */
  textColor: string;
};

/**
 * Hand-tuned per-provider hues. Each pairs a hue with a Tailwind gradient that
 * reads well on both light and dark. Keys must match `Provider` ids.
 */
const MANUAL_HUES: Record<string, { hue: number; gradient: string }> = {
  // Tier 1 — exact usage, most-used
  claude: { hue: 27, gradient: 'from-orange-500 to-amber-500' },
  codex: { hue: 160, gradient: 'from-emerald-500 to-teal-500' },
  gemini: { hue: 217, gradient: 'from-blue-500 to-indigo-500' },
  qwen: { hue: 285, gradient: 'from-violet-500 to-purple-500' },
  goose: { hue: 95, gradient: 'from-lime-500 to-green-500' },
  droid: { hue: 190, gradient: 'from-cyan-500 to-sky-500' },
  amp: { hue: 330, gradient: 'from-pink-500 to-rose-500' },
  kimi: { hue: 12, gradient: 'from-red-500 to-orange-500' },
  copilot: { hue: 240, gradient: 'from-indigo-500 to-blue-600' },
  hermes: { hue: 45, gradient: 'from-amber-500 to-yellow-500' },
  // Tier 2 — partial usage
  opencode: { hue: 175, gradient: 'from-teal-500 to-cyan-500' },
  codebuff: { hue: 60, gradient: 'from-yellow-500 to-amber-500' },
  openclaw: { hue: 310, gradient: 'from-fuchsia-500 to-pink-500' },
  'pi-agent': { hue: 200, gradient: 'from-sky-500 to-blue-500' },
  kilo: { hue: 130, gradient: 'from-green-500 to-emerald-500' },
  // Tier 3 — prompt-history / detect-only (cooler, muted)
  aider: { hue: 35, gradient: 'from-amber-500 to-yellow-600' },
  cursor: { hue: 205, gradient: 'from-sky-500 to-cyan-600' },
  specstory: { hue: 265, gradient: 'from-purple-500 to-violet-600' },
  crush: { hue: 220, gradient: 'from-slate-500 to-slate-600' },
};

const DEFAULT_THEME = { hue: 220, gradient: 'from-slate-500 to-slate-600' };

/** Golden-angle fallback for any provider not in the manual map. */
function computedHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function resolveHue(id: string): number {
  return MANUAL_HUES[id]?.hue ?? computedHue(id);
}

function resolveGradient(id: string): string {
  return MANUAL_HUES[id]?.gradient ?? DEFAULT_THEME.gradient;
}

/** Soft badge classes derived from a hue — readable on light + dark. */
function badgeStyleFromHue(hue: number): CSSProperties {
  return {
    backgroundColor: `hsl(${hue} 70% 50% / 0.12)`,
    color: `hsl(${hue} 70% 40%)`,
    borderColor: `hsl(${hue} 70% 50% / 0.25)`,
  };
}

/** Dark-mode-tuned badge style (use via prefers-color-scheme or .dark context). */
export function badgeStyleDark(hue: number): CSSProperties {
  return {
    backgroundColor: `hsl(${hue} 70% 55% / 0.18)`,
    color: `hsl(${hue} 70% 72%)`,
    borderColor: `hsl(${hue} 70% 55% / 0.3)`,
  };
}

/**
 * Get the full theme for a provider. Always returns a value — never throws.
 */
export function providerTheme(provider: string): ProviderTheme {
  const hue = resolveHue(provider);
  return {
    hue,
    gradient: resolveGradient(provider),
    solid: `${hue} 70% 55%`,
    badgeStyle: badgeStyleFromHue(hue),
    textColor: `hsl(${hue} 70% 45%)`,
  };
}

/** Hue as an hsl() string for SVG/chart usage: e.g. "hsl(27 70% 55%)". */
export function providerHsl(provider: string, lightness = 55, saturation = 70): string {
  return `hsl(${resolveHue(provider)} ${saturation}% ${lightness}%)`;
}

/** Hue as an hsl triplet string (no hsl() wrapper) for SVG stops. */
export function providerTriplet(provider: string): string {
  return `${resolveHue(provider)} 70% 55%`;
}

/** Human-friendly label via the registry, with id fallback. */
export function providerLabel(provider: string): string {
  return getProviderDefinition(provider)?.label ?? provider;
}

/**
 * Resolve a color for an arbitrary label (used when grouping by model/project
 * rather than provider). Uses a stable hash so a given label always maps to the
 * same color across renders.
 */
const LABEL_PALETTE = [217, 160, 38, 280, 340, 95, 190, 330, 265, 130, 12, 200, 45, 310, 175, 60];

export function labelHue(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
}

export function labelHsl(label: string, lightness = 55): string {
  return `hsl(${labelHue(label)} 70% ${lightness}%)`;
}
