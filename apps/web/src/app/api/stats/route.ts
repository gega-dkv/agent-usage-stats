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

    const costByModel = getGroupedUsage(database.db, {
      groupBy: 'model',
      metric: 'cost',
      from,
      to,
      provider,
      usageConfidence,
    }).slice(0, 10);

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

    return NextResponse.json({
      summary,
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
