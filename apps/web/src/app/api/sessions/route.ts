import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';
import type { Provider, UsageConfidence } from '@agent-usage/shared';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = (searchParams.get('provider') || undefined) as Provider | undefined;
    const id = searchParams.get('id');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const orderBy = (searchParams.get('orderBy') as
      | 'date'
      | 'cost'
      | 'tokens'
      | 'provider'
      | 'model') || 'date';
    const usageConfidence = (searchParams.get('usageConfidence') || undefined) as
      | UsageConfidence
      | undefined;

    const database = await getDb();
    const { getSessions, getSessionMessages } = await import('@agent-usage/db');

    if (id) {
      const messages = getSessionMessages(database.db, id);
      return NextResponse.json({ messages });
    }

    const sessions = getSessions(database.db, {
      provider,
      limit,
      orderBy,
      usageConfidence,
    }).map((session) => ({
      id: session.id,
      provider: session.provider,
      projectPath: session.projectPath,
      projectName: session.projectName,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      model: session.model,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens,
      cachedInputTokens: session.cachedInputTokens,
      reasoningTokens: session.reasoningTokens,
      totalTokens: session.totalTokens,
      estimatedCost: session.estimatedCost,
      supportLevel: session.supportLevel,
      usageConfidence: session.usageConfidence,
      costEstimated: session.costEstimated,
      tokenUsageEstimated: session.tokenUsageEstimated,
      pricingSource: session.pricingSource,
    }));
    return NextResponse.json({ sessions });
  } catch (e) {
    console.error('API /sessions error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
