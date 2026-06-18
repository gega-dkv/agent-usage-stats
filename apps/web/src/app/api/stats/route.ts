import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;
    const granularity = searchParams.get('granularity') || 'day';

    const database = await getDb();
    const { getStatsSummary, getDailyUsage, getMonthlyUsage } = await import('@agent-usage/db');
    const summary = getStatsSummary(database.db, { from, to });
    const timeSeries =
      granularity === 'month'
        ? getMonthlyUsage(database.db, { from, to })
        : getDailyUsage(database.db, { from, to });

    return NextResponse.json({ summary, timeSeries });
  } catch (e) {
    console.error('API /stats error:', e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}
