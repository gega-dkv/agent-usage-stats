import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';
import type { Provider } from '@agent-usage/shared';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const provider = (searchParams.get('provider') || undefined) as Provider | undefined;
    const model = searchParams.get('model') || undefined;
    const project = searchParams.get('project') || undefined;
    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const viewMode = searchParams.get('viewMode') || 'preview';

    const database = await getDb();
    const { searchMessages, listUserPrompts } = await import('@agent-usage/db');

    const results = q
      ? await searchMessages(database.db, q, { provider, limit })
      : listUserPrompts(database.db, {
          provider,
          model,
          project,
          from,
          to,
          limit,
          offset,
        });

    const mapped = results.map((row) => {
      const contentHidden = Boolean(
        (row as { contentHidden?: boolean }).contentHidden ||
          row.contentPreview.startsWith('['),
      );
      const supportLevel = (row as { supportLevel?: string }).supportLevel;
      const usageConfidence = (row as { usageConfidence?: string }).usageConfidence;
      const isPromptHistoryOnly = supportLevel === 'prompt-history-only';

      let displayContent = row.contentPreview;
      if (viewMode === 'hidden' || contentHidden || isPromptHistoryOnly) {
        displayContent = '[content hidden]';
      } else if (viewMode === 'preview' && row.contentPreview.length > 200) {
        displayContent = `${row.contentPreview.slice(0, 200)}…`;
      }

      const hasReliableTokens =
        usageConfidence !== 'metadata-only' &&
        usageConfidence !== 'unavailable' &&
        ((row.inputTokens ?? 0) > 0 || (row.outputTokens ?? 0) > 0);

      return {
        id: row.id,
        sessionId: row.sessionId,
        timestamp: row.timestamp,
        role: row.role,
        model: row.model,
        contentPreview: displayContent,
        contentHidden: contentHidden || isPromptHistoryOnly,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        simulatedCost: (row as { simulatedCost?: number }).simulatedCost ?? null,
        provider: row.provider,
        projectName: row.projectName,
        supportLevel,
        usageConfidence,
        hasReliableTokens,
        noReliableUsageMessage: hasReliableTokens
          ? undefined
          : 'No reliable token usage found for this source.',
      };
    });

    return NextResponse.json({
      results: mapped,
      pagination: { limit, offset, count: mapped.length },
    });
  } catch (e) {
    console.error('API /prompts error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
