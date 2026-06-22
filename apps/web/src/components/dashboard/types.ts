import type {
  GroupBy,
  Granularity,
  Metric,
  TimeRange,
} from '@/lib/stats-params';

/** Shape of a row returned by /api/stats `timeSeries` (union across granularities). */
export type TimeSeriesRow = Record<string, unknown>;

export type SessionRow = {
  id: string;
  provider: string;
  projectName?: string;
  model?: string;
  updatedAt?: string;
  totalTokens: number;
  estimatedCost: number;
};

export type StatsSummary = {
  totalSessions: number;
  totalPrompts: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  mostExpensiveModel: string;
  mostExpensiveDay: string;
  topProjects?: { name: string; cost: number; sessions: number }[];
};

export type Quality = {
  metadataOnlyCount: number;
  unavailableCount: number;
  costEstimatedSessions: number;
  tokenEstimatedSessions: number;
  sessionsByUsageConfidence?: Record<string, number>;
  sessionsBySupportLevel?: Record<string, number>;
};

export type StatsResponse = {
  summary: StatsSummary;
  previousSummary?: StatsSummary;
  timeSeries: TimeSeriesRow[];
  grouped: { label: string; value: number }[];
  costByModel: { label: string; value: number }[];
  providerComparison: { label: string; value: number }[];
  recentSessions: SessionRow[];
  expensiveSessions: SessionRow[];
  quality: Quality;
};

export type DashboardFilters = {
  range: TimeRange;
  granularity: Granularity;
  groupBy: GroupBy;
  metric: Metric;
  provider: string;
  usageConfidence: string;
  customFrom: string;
  customTo: string;
};

export const CONFIDENCE_OPTIONS = [
  { value: 'all', label: 'All confidence levels' },
  { value: 'exact', label: 'Exact' },
  { value: 'cumulative-delta', label: 'Cumulative delta' },
  { value: 'provider-recorded-cost', label: 'Provider recorded cost' },
  { value: 'estimated-from-text', label: 'Estimated from text' },
  { value: 'metadata-only', label: 'Metadata only' },
  { value: 'unavailable', label: 'Unavailable' },
] as const;

/** Extract a numeric metric value from a time-series row. */
export function extractMetric(row: TimeSeriesRow, metric: Metric): number {
  const value =
    metric === 'cost'
      ? row.estimatedCost
      : metric === 'input'
        ? row.inputTokens
        : metric === 'output'
          ? row.outputTokens
          : metric === 'cached'
            ? row.cachedInputTokens
            : metric === 'reasoning'
              ? row.reasoningTokens
              : metric === 'prompts'
                ? row.prompts
                : metric === 'sessions'
                  ? row.sessions
                  : row.totalTokens;
  return Number(value ?? 0);
}

/** Extract a human label from a time-series row. */
export function extractLabel(row: TimeSeriesRow): string {
  return (
    (row.date as string)?.slice(5) ||
    (row.week as string)?.slice(5) ||
    (row.month as string) ||
    (row.year as string) ||
    '?'
  );
}
