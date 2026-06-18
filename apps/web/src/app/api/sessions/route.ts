import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') || undefined;
    const id = searchParams.get('id');
    const limit = parseInt(searchParams.get('limit') || '100');
    const orderBy = (searchParams.get('orderBy') as 'date' | 'cost' | 'tokens') || 'date';

    const database = await getDb();
    const { getSessions, getSessionMessages } = await import('@agent-usage/db');

    if (id) {
      const messages = getSessionMessages(database.db, id);
      return NextResponse.json({ messages });
    }

    const sessions = getSessions(database.db, {
      provider: provider as any,
      limit,
      orderBy,
    });
    return NextResponse.json({ sessions });
  } catch (e) {
    console.error('API /sessions error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
