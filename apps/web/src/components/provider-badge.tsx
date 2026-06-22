'use client';

import { Badge } from '@/components/ui/badge';
import { providerTheme, providerLabel } from '@/lib/provider-theme';
import type { ProviderSupportLevel } from '@agent-usage/shared';

/**
 * Provider badge colored by the unified provider-theme map.
 * Shows a small colored dot + the provider's label.
 */
export function ProviderBadge({
  provider,
  label,
  variant = 'soft',
  className,
  showDot = true,
}: {
  provider: string;
  label?: string;
  variant?: 'soft' | 'outline';
  className?: string;
  showDot?: boolean;
}) {
  const theme = providerTheme(provider);
  const text = label ?? providerLabel(provider);
  return (
    <Badge
      variant={variant === 'outline' ? 'outline' : 'soft'}
      className={className}
      style={variant === 'soft' ? theme.badgeStyle : undefined}
    >
      {showDot && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: `hsl(${theme.solid})` }}
          aria-hidden
        />
      )}
      {text}
    </Badge>
  );
}

const SUPPORT_VARIANT: Record<
  ProviderSupportLevel,
  { variant: 'success' | 'info' | 'warning' | 'muted' | 'destructive'; label: string }
> = {
  'exact-usage': { variant: 'success', label: 'Exact usage' },
  'partial-usage': { variant: 'info', label: 'Partial usage' },
  'prompt-history-only': { variant: 'warning', label: 'Prompt history only' },
  'detected-only': { variant: 'muted', label: 'Detected only' },
  unsupported: { variant: 'destructive', label: 'Unsupported' },
};

export function SupportLevelBadge({ level, className }: { level: ProviderSupportLevel; className?: string }) {
  const cfg = SUPPORT_VARIANT[level] ?? SUPPORT_VARIANT['detected-only'];
  return (
    <Badge variant={cfg.variant} className={className}>
      {cfg.label}
    </Badge>
  );
}

const CONFIDENCE_META: Record<string, { label: string; variant: 'success' | 'info' | 'warning' | 'muted' }> = {
  exact: { label: 'Exact', variant: 'success' },
  'cumulative-delta': { label: 'Cumulative', variant: 'info' },
  'provider-recorded-cost': { label: 'Recorded $', variant: 'info' },
  'estimated-from-text': { label: 'Estimated', variant: 'warning' },
  'metadata-only': { label: 'Metadata', variant: 'muted' },
  unavailable: { label: 'Unavailable', variant: 'muted' },
};

export function ConfidenceBadge({ confidence, className }: { confidence: string; className?: string }) {
  const meta = CONFIDENCE_META[confidence] ?? { label: confidence, variant: 'muted' as const };
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}
