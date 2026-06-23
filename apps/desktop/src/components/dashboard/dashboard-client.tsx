import { useMemo } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { UsageLineChart, UsageBarChart, ProviderDonutChart, CalendarHeatmap, ModelCostRanking } from '@agent-usage/ui';
import { useQuery } from '@/lib/use-query';
import { fetchJson } from '@/lib/api';
import { useUrlFilters } from '@/lib/use-filters';
import { listProviders } from '@agent-usage/shared';
import { formatNumber, formatCurrency, providerLabel } from '@/lib/format';
import { providerHsl, labelHsl } from '@/lib/provider-theme';
import { metricLabel } from '@/lib/stats-params';
import type { GroupBy, Granularity, Metric, TimeRange } from '@/lib/stats-params';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScanButton } from '@/components/scan-button';
import { DashboardFiltersBar } from './dashboard-filters';
import { StatCards } from './stat-cards';
import { SessionTable } from './session-table';
import { DashboardEmptyState, DashboardError, DashboardLoadingSkeleton } from './states';
import { extractMetric, extractLabel, type DashboardFilters, type StatsResponse } from './types';

const DEFAULTS: DashboardFilters = {
  range: 'month',
  granularity: 'day',
  groupBy: 'provider',
  metric: 'tokens',
  provider: 'all',
  usageConfidence: 'all',
  customFrom: '',
  customTo: '',
};

export function DashboardClient() {
  // useUrlFilters returns string values from the URL; we cast back to the
  // strongly-typed DashboardFilters shape for ergonomic downstream usage.
  const { filters: rawFilters, setFilter, resetFilters, isDirty } = useUrlFilters(DEFAULTS);
  const filters: DashboardFilters = {
    range: rawFilters.range as TimeRange,
    granularity: rawFilters.granularity as Granularity,
    groupBy: rawFilters.groupBy as GroupBy,
    metric: rawFilters.metric as Metric,
    provider: rawFilters.provider,
    usageConfidence: rawFilters.usageConfidence,
    customFrom: rawFilters.customFrom,
    customTo: rawFilters.customTo,
  };

  // Build the cache key from the active filters so changing any re-fetches.
  const statsKey = useMemo(() => {
    const params = new URLSearchParams({
      range: filters.range,
      granularity: filters.granularity,
      groupBy: filters.groupBy,
      metric: filters.metric,
    });
    if (filters.provider && filters.provider !== 'all') params.set('provider', filters.provider);
    if (filters.usageConfidence && filters.usageConfidence !== 'all') params.set('usageConfidence', filters.usageConfidence);
    if (filters.range === 'custom') {
      if (filters.customFrom) params.set('from', filters.customFrom);
      if (filters.customTo) params.set('to', filters.customTo);
    }
    return `/api/stats?${params.toString()}`;
  }, [filters]);

  const { data, error, loading, mutate } = useQuery<StatsResponse>(statsKey, {
    fetcher: (key) => fetchJson<StatsResponse>(key),
  });

  if (error && !data) {
    return (
      <div className="flex flex-col gap-6">
        <DashboardHeader onSync={mutate} />
        <DashboardError message={error.message} />
      </div>
    );
  }

  const summary = data?.summary;
  const hasData = summary && summary.totalSessions > 0;

  const timeSeriesChart = useMemo(() => {
    if (!data?.timeSeries?.length) return [];
    return data.timeSeries.map((row) => ({
      label: extractLabel(row),
      value: extractMetric(row, filters.metric),
    }));
  }, [data?.timeSeries, filters.metric]);

  const heatmapData = useMemo(() => {
    if (!data?.timeSeries?.length || filters.granularity !== 'day') return [];
    return data.timeSeries.map((row) => ({
      date: row.date as string,
      value: Number(row.totalTokens ?? 0),
    }));
  }, [data?.timeSeries, filters.granularity]);

  const groupedChart = (data?.grouped ?? []).map((d) => ({
    label: filters.groupBy === 'provider' ? providerLabel(d.label) : d.label,
    value: d.value,
  }));

  const modelRankingData = (data?.costByModel ?? []).map((d) => ({
    model: d.label,
    cost: d.value,
    tokens: 0,
    sessions: 0,
  }));

  const groupedTotal = groupedChart.reduce((sum, d) => sum + d.value, 0);

  const formatMetric = (v: number) =>
    filters.metric === 'cost' ? formatCurrency(v) : formatNumber(v);

  // Resolve a color for a chart label. When grouping by provider, labels are
  // provider display names — map back to the provider id for its hue. For other
  // groupings (model/project), fall back to a stable hash-based hue.
  const colorForProvider = (label: string) => {
    const id = labelToProviderId(label);
    return id ? providerHsl(id) : labelHsl(label);
  };
  const colorForGroup = (label: string) =>
    filters.groupBy === 'provider' ? colorForProvider(label) : labelHsl(label);

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader onSync={mutate} />

      <DashboardFiltersBar
        filters={filters}
        onChange={(key, value) => setFilter(key, value)}
        onReset={resetFilters}
        isDirty={isDirty}
      />

      {loading && !data ? (
        <DashboardLoadingSkeleton />
      ) : !hasData ? (
        <DashboardEmptyState />
      ) : (
        <>
          {(data?.quality?.metadataOnlyCount ?? 0) > 0 && (
            <QualityBanner
              variant="warning"
              title={`${data?.quality.metadataOnlyCount} metadata-only sessions`}
              description="Some sessions have no reliable token usage. Their costs may be estimated or unavailable (prompt-history-only sources)."
            />
          )}

          <StatCards
            summary={summary!}
            previous={data?.previousSummary}
            timeSeries={data?.timeSeries ?? []}
            metric={filters.metric as Metric}
            groupedTotal={groupedTotal}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {metricLabel(filters.metric as Metric)} over time
                </CardTitle>
                <CardDescription className="text-xs">{filters.granularity} granularity</CardDescription>
              </CardHeader>
              <CardContent>
                <UsageLineChart data={timeSeriesChart} height={260} formatValue={formatMetric} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Provider comparison</CardTitle>
                <CardDescription className="text-xs">
                  {metricLabel(filters.metric as Metric)} by provider
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProviderDonutChart
                  data={(data?.providerComparison ?? []).map((d) => ({
                    label: providerLabel(d.label),
                    value: d.value,
                  }))}
                  formatValue={formatMetric}
                  colorFor={colorForProvider}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">
                  {metricLabel(filters.metric as Metric)} by {filters.groupBy}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageBarChart data={groupedChart} formatValue={formatMetric} colorFor={colorForGroup} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Cost by model</CardTitle>
                <CardDescription className="text-xs">Top models by estimated cost</CardDescription>
              </CardHeader>
              <CardContent>
                <ModelCostRanking
                  data={modelRankingData}
                  formatCost={formatCurrency}
                  formatTokens={formatNumber}
                />
              </CardContent>
            </Card>
          </div>

          {heatmapData.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Activity heatmap</CardTitle>
                <CardDescription className="text-xs">Daily token volume</CardDescription>
              </CardHeader>
              <CardContent>
                <CalendarHeatmap data={heatmapData} formatValue={formatNumber} />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SessionTable title="Recent sessions" sessions={data?.recentSessions ?? []} />
            <SessionTable title="Most expensive sessions" sessions={data?.expensiveSessions ?? []} />
          </div>

          <QualityBanner
            variant="info"
            title="Costs are estimates"
            description="All costs shown are simulated API-equivalent estimates based on your configured pricing. They do not represent billed amounts."
          />
        </>
      )}
    </div>
  );
}

function DashboardHeader({ onSync }: { onSync: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Overview</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Local-first view of your AI session usage and costs</p>
      </div>
      <ScanButton onComplete={onSync} />
    </div>
  );
}

function QualityBanner({
  variant,
  title,
  description,
}: {
  variant: 'warning' | 'info';
  title: string;
  description: string;
}) {
  const isWarning = variant === 'warning';
  const Icon = isWarning ? AlertTriangle : Info;
  return (
    <div
      className={
        'flex items-start gap-3 rounded-lg border px-4 py-3 ' +
        (isWarning
          ? 'border-warning/30 bg-warning/10'
          : 'border-info/30 bg-info/10')
      }
    >
      <Icon className={isWarning ? 'mt-0.5 h-4 w-4 shrink-0 text-warning' : 'mt-0.5 h-4 w-4 shrink-0 text-info'} />
      <div className="min-w-0">
        <p className={isWarning ? 'text-sm font-medium text-warning' : 'text-sm font-medium text-info'}>{title}</p>
        <p className={isWarning ? 'mt-0.5 text-xs text-warning/80' : 'mt-0.5 text-xs text-info/80'}>{description}</p>
      </div>
    </div>
  );
}

/** Reverse-lookup a provider id from its display label (e.g. "Claude Code" → "claude"). */
const LABEL_TO_ID = new Map(listProviders().map((p) => [p.label, p.id]));
function labelToProviderId(label: string): string | undefined {
  return LABEL_TO_ID.get(label);
}
