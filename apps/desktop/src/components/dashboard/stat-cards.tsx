import { DollarSign, Sigma, Hash, Star } from 'lucide-react';
import { StatCard } from './stat-card';
import { Sparkline } from './sparkline';
import { providerColor, formatCurrency, formatNumber, formatPercentDelta } from '@/lib/format';
import type { StatsSummary, TimeSeriesRow } from './types';
import { extractMetric } from './types';
import type { Metric } from '@/lib/stats-params';

export function StatCards({
  summary,
  previous,
  timeSeries,
  metric,
  groupedTotal,
}: {
  summary: StatsSummary;
  previous?: StatsSummary;
  timeSeries: TimeSeriesRow[];
  metric: Metric;
  groupedTotal: number;
}) {
  // Sparkline data: last 7 points of the time series for the current metric.
  const spark = timeSeries.slice(-7).map((r) => extractMetric(r, metric));

  const costTrend = previous ? formatPercentDelta(summary.totalEstimatedCost, previous.totalEstimatedCost) : undefined;
  const tokenTrend = previous ? formatPercentDelta(groupedTotal || summary.totalTokens, previous.totalTokens) : undefined;
  const sessionTrend = previous ? formatPercentDelta(summary.totalSessions, previous.totalSessions) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Estimated Cost"
        value={formatCurrency(summary.totalEstimatedCost)}
        subValue="Simulated API equivalent"
        gradient={providerColor('claude')}
        accent="hsl(27 92% 50%)"
        spark={costTrend ? spark : undefined}
        trend={costTrend}
        icon={<DollarSign className="h-4 w-4" />}
      />
      <StatCard
        label={metricLabel(metric)}
        value={formatNumber(groupedTotal || summary.totalTokens)}
        subValue={`${formatNumber(summary.totalInputTokens)} in · ${formatNumber(summary.totalOutputTokens)} out`}
        gradient={providerColor('codex')}
        accent="hsl(160 84% 39%)"
        spark={tokenTrend ? spark : undefined}
        trend={tokenTrend}
        icon={<Sigma className="h-4 w-4" />}
      />
      <StatCard
        label="Sessions"
        value={formatNumber(summary.totalSessions)}
        subValue={`${formatNumber(summary.totalPrompts)} prompts`}
        gradient={providerColor('gemini')}
        accent="hsl(217 91% 60%)"
        trend={sessionTrend}
        icon={<Hash className="h-4 w-4" />}
      />
      <StatCard
        label="Top Model"
        value={summary.mostExpensiveModel || 'N/A'}
        subValue={summary.mostExpensiveDay ? `Peak day: ${summary.mostExpensiveDay}` : undefined}
        gradient="from-pink-500 to-rose-500"
        accent="hsl(340 82% 52%)"
        icon={<Star className="h-4 w-4" />}
      />
    </div>
  );
}

// Avoid extra import churn by re-exporting a local metricLabel.
function metricLabel(metric: Metric): string {
  switch (metric) {
    case 'cost':
      return 'Estimated Cost';
    case 'input':
      return 'Input Tokens';
    case 'output':
      return 'Output Tokens';
    case 'cached':
      return 'Cached Tokens';
    case 'reasoning':
      return 'Reasoning Tokens';
    case 'prompts':
      return 'Prompts';
    case 'sessions':
      return 'Sessions';
    default:
      return 'Total Tokens';
  }
}

// Re-export to keep Sparkline import meaningful if used elsewhere later.
export { Sparkline };
