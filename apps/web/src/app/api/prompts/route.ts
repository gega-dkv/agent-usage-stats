import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const provider = searchParams.get('provider') || undefined;
    const limit = parseInt(searchParams.get('limit') || '50');

    const database = await getDb();
    const { searchMessages } = await import('@agent-usage/db');
    const results = searchMessages(database.db, q, {
      provider: provider as any,
      limit,
    });
    return NextResponse.json({ results });
  } catch (e) {
    console.error('API /prompts error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
