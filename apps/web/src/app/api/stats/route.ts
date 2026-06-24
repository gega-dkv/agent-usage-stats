import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';
import type { Provider, UsageConfidence } from '@agent-usage/shared';
import {
  resolveDateRange,
  type GroupBy,
  type Metric,
  type TimeRange,
  type Granularity,
} from '@/lib/stats-params';

export const dynamic = 'force-dynamic';

/**
 * Compute the date range for the "previous period" — the equal-length window
 * immediately before the current `from`. Used to power trend deltas on KPI cards.
 */
function previousRange(
  range: TimeRange,
  from?: string,
  to?: string,
): { from?: string; to?: string } {
  if (!from) return {};
  const startMs = new Date(from).getTime();
  if (Number.isNaN(startMs)) return {};
  const endMs = to ? new Date(to).getTime() : Date.now();
  const spanMs = Math.max(0, endMs - startMs);

  if (range === 'custom') {
    return { from: new Date(startMs - spanMs).toISOString(), to: new Date(startMs).toISOString() };
  }

  // Mirror resolveDateRange's offsets to compute the prior window start.
  const prevStart = new Date(startMs);
  const prevTo = new Date(startMs);
  switch (range) {
    case 'day':
      prevStart.setUTCDate(prevStart.getUTCDate() - 1);
      break;
    case 'week':
      prevStart.setUTCDate(prevStart.getUTCDate() - 7);
      break;
    case 'month':
      prevStart.setUTCDate(prevStart.getUTCDate() - 30);
      break;
    case 'year':
      prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1);
      break;
  }
  return { from: prevStart.toISOString(), to: prevTo.toISOString() };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get('range') || 'month') as TimeRange;
    const customFrom = searchParams.get('from') || undefined;
    const customTo = searchParams.get('to') || undefined;
    const granularity = (searchParams.get('granularity') || 'day') as Granularity;
    const groupBy = (searchParams.get('groupBy') || 'provider') as GroupBy;
    const metric = (searchParams.get('metric') || 'tokens') as Metric;
    const provider = (searchParams.get('provider') || undefined) as Provider | undefined;
    const usageConfidence = (searchParams.get('usageConfidence') || undefined) as
      | UsageConfidence
      | undefined;

    const { from, to } = resolveDateRange(range, customFrom, customTo);

    const database = await getDb();
    const {
      getStatsSummary,
      getDailyUsage,
      getWeeklyUsage,
      getMonthlyUsage,
      getYearlyUsage,
      getGroupedUsage,
      getModelCostBreakdown,
      getSessions,
    } = await import('@agent-usage/db');

    const summary = getStatsSummary(database.db, { from, to });
    const filterOpts = { from, to, provider };

    let timeSeries: unknown[];
    switch (granularity) {
      case 'week':
        timeSeries = getWeeklyUsage(database.db, filterOpts);
        break;
      case 'month':
        timeSeries = getMonthlyUsage(database.db, filterOpts);
        break;
      case 'year':
        timeSeries = getYearlyUsage(database.db, filterOpts);
        break;
      default:
        timeSeries = getDailyUsage(database.db, filterOpts);
    }

    const grouped = getGroupedUsage(database.db, {
      groupBy,
      metric,
      from,
      to,
      provider,
      usageConfidence,
    });

    const costByModel = getModelCostBreakdown(database.db, { from, to, provider, usageConfidence });

    const providerComparison = getGroupedUsage(database.db, {
      groupBy: 'provider',
      metric,
      from,
      to,
      usageConfidence,
    });

    const recentSessions = getSessions(database.db, {
      from,
      to,
      provider,
      usageConfidence,
      limit: 8,
      orderBy: 'date',
    });

    const expensiveSessions = getSessions(database.db, {
      from,
      to,
      provider,
      usageConfidence,
      limit: 8,
      orderBy: 'cost',
    });

    const metadataOnlyCount = summary.sessionsByUsageConfidence?.['metadata-only'] ?? 0;
    const unavailableCount = summary.sessionsByUsageConfidence?.unavailable ?? 0;

    // Previous-period summary for trend deltas on KPI cards. Backward-compatible:
    // omitted entirely on error rather than failing the whole request.
    let previousSummary: typeof summary | undefined;
    try {
      const prev = previousRange(range, from, to);
      if (prev.from) previousSummary = getStatsSummary(database.db, prev);
    } catch {
      previousSummary = undefined;
    }

    return NextResponse.json({
      summary,
      previousSummary,
      timeSeries,
      grouped,
      costByModel,
      providerComparison,
      recentSessions,
      expensiveSessions,
      quality: {
        metadataOnlyCount,
        unavailableCount,
        costEstimatedSessions: summary.costEstimatedSessions,
        tokenEstimatedSessions: summary.tokenEstimatedSessions,
        sessionsByUsageConfidence: summary.sessionsByUsageConfidence,
        sessionsBySupportLevel: summary.sessionsBySupportLevel,
      },
      filters: { range, from, to, granularity, groupBy, metric, provider, usageConfidence },
    });
  } catch (e) {
    console.error('API /stats error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
