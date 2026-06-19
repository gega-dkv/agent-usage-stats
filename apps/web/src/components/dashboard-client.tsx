'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  UsageLineChart,
  UsageBarChart,
  ProviderDonutChart,
  CalendarHeatmap,
  ModelCostRanking,
} from '@agent-usage/ui';
import { formatNumber, formatCurrency, providerLabel, providerColor } from '@/lib/format';
import {
  type GroupBy,
  type Metric,
  type TimeRange,
  type Granularity,
  metricLabel,
} from '@/lib/stats-params';
import { StatCard } from '@/components/stat-card';
import { ScanButton } from '@/components/scan-button';
import { listProviderIds, getProviderDefinition } from '@agent-usage/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

type StatsResponse = {
  summary: {
    totalSessions: number;
    totalPrompts: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalEstimatedCost: number;
    mostExpensiveModel: string;
    mostExpensiveDay: string;
    topProjects: { name: string; cost: number; sessions: number }[];
  };
  timeSeries: Record<string, unknown>[];
  grouped: { label: string; value: number }[];
  costByModel: { label: string; value: number }[];
  providerComparison: { label: string; value: number }[];
  recentSessions: SessionRow[];
  expensiveSessions: SessionRow[];
  quality: {
    metadataOnlyCount: number;
    unavailableCount: number;
    costEstimatedSessions: number;
    tokenEstimatedSessions: number;
  };
};

type SessionRow = {
  id: string;
  provider: string;
  projectName?: string;
  model?: string;
  updatedAt?: string;
  totalTokens: number;
  estimatedCost: number;
};

const CONFIDENCE_OPTIONS = [
  { value: 'all', label: 'All confidence levels' },
  { value: 'exact', label: 'Exact' },
  { value: 'cumulative-delta', label: 'Cumulative delta' },
  { value: 'provider-recorded-cost', label: 'Provider recorded cost' },
  { value: 'estimated-from-text', label: 'Estimated from text' },
  { value: 'metadata-only', label: 'Metadata only' },
  { value: 'unavailable', label: 'Unavailable' },
];

export function DashboardClient() {
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRange>('month');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [groupBy, setGroupBy] = useState<GroupBy>('provider');
  const [metric, setMetric] = useState<Metric>('tokens');
  const [provider, setProvider] = useState('all');
  const [usageConfidence, setUsageConfidence] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const providerOptions = useMemo(
    () =>
      listProviderIds().map((id) => ({
        id,
        label: getProviderDefinition(id)?.label ?? id,
      })),
    [],
  );

  const fetchStats = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      range,
      granularity,
      groupBy,
      metric,
    });
    if (provider && provider !== 'all') params.set('provider', provider);
    if (usageConfidence && usageConfidence !== 'all') params.set('usageConfidence', usageConfidence);
    if (range === 'custom') {
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);
    }

    fetch(`/api/stats?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setData(d);
          setError(null);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, [range, granularity, groupBy, metric, provider, usageConfidence, customFrom, customTo]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-destructive">Database Error</CardTitle>
            <CardDescription className="text-destructive/80">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive/80">
              Try running <code className="rounded bg-muted px-1">agent-usage sync</code> from the CLI.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = data?.summary;
  const hasData = summary && summary.totalSessions > 0;

  const timeSeriesChart = useMemo(() => {
    if (!data?.timeSeries?.length) return [];
    return data.timeSeries.map((row) => {
      const r = row as Record<string, unknown>;
      const label =
        (r.date as string)?.slice(5) ||
        (r.week as string)?.slice(5) ||
        (r.month as string) ||
        (r.year as string) ||
        '?';
      const value =
        metric === 'cost'
          ? Number(r.estimatedCost ?? 0)
          : metric === 'input'
            ? Number(r.inputTokens ?? 0)
            : metric === 'output'
              ? Number(r.outputTokens ?? 0)
              : metric === 'cached'
                ? Number(r.cachedInputTokens ?? 0)
                : metric === 'reasoning'
                  ? Number(r.reasoningTokens ?? 0)
                  : metric === 'prompts'
                    ? Number(r.prompts ?? 0)
                    : metric === 'sessions'
                      ? Number(r.sessions ?? 0)
                      : Number(r.totalTokens ?? 0);
      return { label, value };
    });
  }, [data?.timeSeries, metric]);

  const heatmapData = useMemo(() => {
    if (!data?.timeSeries?.length || granularity !== 'day') return [];
    return data.timeSeries.map((row) => {
      const r = row as Record<string, unknown>;
      return { date: r.date as string, value: Number(r.totalTokens ?? 0) };
    });
  }, [data?.timeSeries, granularity]);

  const groupedChart = (data?.grouped ?? []).map((d) => ({
    label: groupBy === 'provider' ? providerLabel(d.label) : d.label,
    value: d.value,
  }));

  const modelRankingData = useMemo(
    () =>
      (data?.costByModel ?? []).map((d) => ({
        model: d.label,
        cost: d.value,
        tokens: 0,
        sessions: 0,
      })),
    [data?.costByModel],
  );

  const formatMetric = (v: number) => (metric === 'cost' ? formatCurrency(v) : formatNumber(v));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Local-first view of your AI session usage and costs
          </p>
        </div>
        <ScanButton onComplete={fetchStats} />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-3">
          <FilterSelect label="Range" value={range} onChange={(v) => setRange(v as TimeRange)}>
            <SelectItem value="day">Day</SelectItem>
            <SelectItem value="week">Week</SelectItem>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="year">Year</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </FilterSelect>
          {range === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </>
          )}
          <FilterSelect
            label="Granularity"
            value={granularity}
            onChange={(v) => setGranularity(v as Granularity)}
          >
            <SelectItem value="day">Day</SelectItem>
            <SelectItem value="week">Week</SelectItem>
            <SelectItem value="month">Month</SelectItem>
            <SelectItem value="year">Year</SelectItem>
          </FilterSelect>
          <FilterSelect label="Group by" value={groupBy} onChange={(v) => setGroupBy(v as GroupBy)}>
            <SelectItem value="provider">Provider</SelectItem>
            <SelectItem value="model">Model</SelectItem>
            <SelectItem value="project">Project</SelectItem>
            <SelectItem value="role">Role</SelectItem>
          </FilterSelect>
          <FilterSelect label="Metric" value={metric} onChange={(v) => setMetric(v as Metric)}>
            <SelectItem value="tokens">Tokens</SelectItem>
            <SelectItem value="input">Input</SelectItem>
            <SelectItem value="output">Output</SelectItem>
            <SelectItem value="cached">Cached</SelectItem>
            <SelectItem value="reasoning">Reasoning</SelectItem>
            <SelectItem value="cost">Cost</SelectItem>
            <SelectItem value="prompts">Prompts</SelectItem>
            <SelectItem value="sessions">Sessions</SelectItem>
          </FilterSelect>
          <FilterSelect label="Provider" value={provider} onChange={setProvider}>
            <SelectItem value="all">All providers</SelectItem>
            {providerOptions.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </FilterSelect>
          <FilterSelect label="Confidence" value={usageConfidence} onChange={setUsageConfidence}>
            {CONFIDENCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </FilterSelect>
        </div>
      </Card>

      {loading && !data ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      ) : !hasData ? (
        <EmptyState />
      ) : (
        <>
          {(data?.quality?.metadataOnlyCount ?? 0) > 0 && (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-amber-800 dark:text-amber-200">
                  Metadata-only sessions detected
                </CardTitle>
                <CardDescription className="text-amber-700 dark:text-amber-300">
                  {data?.quality.metadataOnlyCount} sessions have no reliable token usage. Costs may be
                  estimated or unavailable for prompt-history-only sources.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Estimated Cost"
              value={formatCurrency(summary!.totalEstimatedCost)}
              subValue="Simulated API equivalent"
              gradient={providerColor('claude')}
              icon={<span className="text-lg">$</span>}
            />
            <StatCard
              label={metricLabel(metric)}
              value={formatMetric(
                groupedChart.reduce((sum, d) => sum + d.value, 0) || summary!.totalTokens,
              )}
              subValue={`${formatNumber(summary!.totalInputTokens)} in · ${formatNumber(summary!.totalOutputTokens)} out`}
              gradient={providerColor('codex')}
              icon={<span className="text-lg">Σ</span>}
            />
            <StatCard
              label="Sessions"
              value={summary!.totalSessions.toString()}
              subValue={`${summary!.totalPrompts} prompts`}
              gradient={providerColor('gemini')}
              icon={<span className="text-lg">#</span>}
            />
            <StatCard
              label="Most Expensive Model"
              value={summary!.mostExpensiveModel || 'N/A'}
              subValue={`Top day: ${summary!.mostExpensiveDay}`}
              gradient="from-pink-500 to-rose-500"
              icon={<span className="text-lg">★</span>}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{metricLabel(metric)} over time</CardTitle>
                <CardDescription>{granularity} granularity</CardDescription>
              </CardHeader>
              <CardContent>
                <UsageLineChart data={timeSeriesChart} height={240} formatValue={formatMetric} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Provider comparison</CardTitle>
                <CardDescription>{metricLabel(metric)} by provider</CardDescription>
              </CardHeader>
              <CardContent>
                <ProviderDonutChart
                  data={(data?.providerComparison ?? []).map((d) => ({
                    label: providerLabel(d.label),
                    value: d.value,
                  }))}
                  formatValue={formatMetric}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  {metricLabel(metric)} by {groupBy}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UsageBarChart data={groupedChart} formatValue={formatMetric} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cost by model</CardTitle>
                <CardDescription>Top models by estimated cost</CardDescription>
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
              <CardHeader>
                <CardTitle>Activity heatmap</CardTitle>
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

          <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-amber-800 dark:text-amber-200">
                Costs are estimates
              </CardTitle>
              <CardDescription className="text-amber-700 dark:text-amber-300">
                All costs shown are simulated API-equivalent estimates based on configured pricing.
              </CardDescription>
            </CardHeader>
          </Card>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function SessionTable({ title, sessions }: { title: string; sessions: SessionRow[] }) {
  if (!sessions.length) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link href="/sessions" className="text-xs font-medium text-primary hover:underline">
          View all →
        </Link>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/sessions/${encodeURIComponent(s.id)}`} className="hover:underline">
                    {s.projectName || s.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{providerLabel(s.provider)}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">{formatNumber(s.totalTokens)}</TableCell>
                <TableCell className="text-right font-mono">{formatCurrency(s.estimatedCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed bg-card/50 p-12 text-center">
      <h2 className="text-2xl font-bold">No data yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Run a sync to import session data. All processing happens locally.
      </p>
      <div className="mt-6">
        <ScanButton />
      </div>
    </Card>
  );
}
