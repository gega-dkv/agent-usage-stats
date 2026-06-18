import { getDb } from '@/lib/db-server';
import { formatNumber, formatCurrency, providerLabel, providerColor } from '@/lib/format';
import { StatCard } from '@/components/stat-card';
import { LineChart } from '@/components/charts/line-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { DonutChart } from '@/components/charts/donut-chart';
import { CalendarHeatmap } from '@/components/charts/heatmap';
import { ScanButton } from '@/components/scan-button';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  let summary: any = null;
  let dailyUsage: any[] = [];
  let monthlyUsage: any[] = [];
  let dbError: string | null = null;

  try {
    const database = await getDb();
    const { getStatsSummary, getDailyUsage, getMonthlyUsage } = await import('@agent-usage/db');
    summary = getStatsSummary(database.db);
    dailyUsage = getDailyUsage(database.db);
    monthlyUsage = getMonthlyUsage(database.db);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950">
          <h2 className="font-semibold text-red-800 dark:text-red-200">Database Error</h2>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{dbError}</p>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">
            Try running <code className="rounded bg-red-100 px-1 dark:bg-red-900">agent-usage sync</code> from the CLI.
          </p>
        </div>
      </div>
    );
  }

  const hasData = summary && summary.totalSessions > 0;

  // Build time series from daily data
  const timeSeries = dailyUsage
    .reduce((acc: any[], row: any) => {
      const existing = acc.find((d) => d.date === row.date);
      if (existing) {
        existing.value += row.totalTokens || 0;
        existing.cost += row.estimatedCost || 0;
      } else {
        acc.push({
          date: row.date.slice(5), // MM-DD
          value: row.totalTokens || 0,
          cost: row.estimatedCost || 0,
        });
      }
      return acc;
    }, [])
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Cost by provider
  const costByProvider = dailyUsage.reduce((acc: any[], row: any) => {
    const existing = acc.find((d) => d.label === providerLabel(row.provider));
    if (existing) {
      existing.value += row.estimatedCost || 0;
    } else {
      acc.push({ label: providerLabel(row.provider), value: row.estimatedCost || 0 });
    }
    return acc;
  }, []);

  // Tokens by provider
  const tokensByProvider = dailyUsage.reduce((acc: any[], row: any) => {
    const existing = acc.find((d) => d.label === providerLabel(row.provider));
    if (existing) {
      existing.value += row.totalTokens || 0;
    } else {
      acc.push({ label: providerLabel(row.provider), value: row.totalTokens || 0 });
    }
    return acc;
  }, []);

  // Top projects
  const topProjects = (summary?.topProjects || []).slice(0, 5);

  // Most expensive sessions
  const topSessions = monthlyUsage
    .reduce((acc: any[], row: any) => {
      acc.push({
        date: row.month,
        provider: row.provider,
        model: row.model || 'unknown',
        tokens: row.totalTokens,
        cost: row.estimatedCost,
      });
      return acc;
    }, [])
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);

  // Heatmap data
  const heatmapData = dailyUsage.map((row: any) => ({
    date: row.date,
    value: row.totalTokens || 0,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Local-first view of your AI session usage and costs
          </p>
        </div>
        <ScanButton />
      </div>

      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Estimated Cost"
              value={formatCurrency(summary.totalEstimatedCost)}
              subValue="Simulated API equivalent"
              gradient={providerColor('claude')}
              icon={
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
            />
            <StatCard
              label="Total Tokens"
              value={formatNumber(summary.totalTokens)}
              subValue={`${formatNumber(summary.totalInputTokens)} in · ${formatNumber(summary.totalOutputTokens)} out`}
              gradient={providerColor('codex')}
              icon={
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
              }
            />
            <StatCard
              label="Sessions"
              value={summary.totalSessions.toString()}
              subValue={`${summary.totalPrompts} prompts`}
              gradient={providerColor('gemini')}
              icon={
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              }
            />
            <StatCard
              label="Most Expensive"
              value={summary.mostExpensiveModel || 'N/A'}
              subValue={`Top day: ${summary.mostExpensiveDay}`}
              gradient="from-pink-500 to-rose-500"
              icon={
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              }
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Time series */}
            <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Token usage over time</h3>
                  <p className="text-xs text-muted-foreground">Last 30 days of activity</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    Tokens
                  </span>
                </div>
              </div>
              <LineChart data={timeSeries.map((d: any) => ({ label: d.date, value: d.value }))} height={240} />
            </div>

            {/* Cost by provider */}
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Cost by Provider</h3>
              <p className="mb-4 text-xs text-muted-foreground">Distribution of estimated cost</p>
              <DonutChart data={costByProvider} formatValue={formatCurrency} />
            </div>
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Tokens by Provider</h3>
              <p className="mb-4 text-xs text-muted-foreground">Total tokens per provider</p>
              <BarChart
                data={tokensByProvider}
                formatValue={(v) => formatNumber(v)}
              />
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h3 className="text-lg font-semibold">Top Projects</h3>
              <p className="mb-4 text-xs text-muted-foreground">By estimated cost</p>
              {topProjects.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No project data</p>
              ) : (
                <div className="space-y-3">
                  {topProjects.map((p: any, i: number) => {
                    const max = topProjects[0]?.cost || 1;
                    return (
                      <div key={i} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatCurrency(p.cost)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500"
                            style={{ width: `${(p.cost / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Heatmap */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="text-lg font-semibold">Activity heatmap</h3>
            <p className="mb-4 text-xs text-muted-foreground">Last 26 weeks of token usage</p>
            <CalendarHeatmap data={heatmapData} />
          </div>

          {/* Top sessions */}
          {topSessions.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">Top spending periods</h3>
                  <p className="text-xs text-muted-foreground">By estimated cost</p>
                </div>
                <Link
                  href="/sessions"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  View all sessions →
                </Link>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5">Period</th>
                      <th className="px-4 py-2.5">Provider</th>
                      <th className="px-4 py-2.5">Model</th>
                      <th className="px-4 py-2.5 text-right">Tokens</th>
                      <th className="px-4 py-2.5 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSessions.map((s: any, i: number) => (
                      <tr key={i} className="border-b border-border text-sm last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{s.date}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                            {providerLabel(s.provider)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{s.model}</td>
                        <td className="px-4 py-3 text-right font-mono">{formatNumber(s.tokens)}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {formatCurrency(s.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Privacy notice */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <div className="flex items-start gap-3">
              <svg className="h-5 w-5 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  Costs are estimates
                </h4>
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                  All costs shown are simulated API-equivalent estimates based on configured pricing. Actual costs may vary based on your subscription, usage tier, or negotiated rates.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-12 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg">
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </div>
      <h2 className="mt-6 text-2xl font-bold">No data yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Run a sync from the CLI to import session data from Claude, Codex, and Gemini.
        All processing happens locally on your machine.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-xs">pnpm cli sync</code>
        <span className="text-xs text-muted-foreground">or</span>
        <code className="rounded-md bg-muted px-3 py-1.5 font-mono text-xs">pnpm cli seed</code>
      </div>
      <div className="mt-6">
        <ScanButton />
      </div>
    </div>
  );
}
