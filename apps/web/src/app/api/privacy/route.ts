import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const database = await getDb();
    const { getSetting } = await import('@agent-usage/db');
    const privacyMode = getSetting(database.db, 'privacyMode') || 'disabled';
    return NextResponse.json({ privacyMode });
  } catch (e) {
    console.error('API /privacy GET error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const database = await getDb();
    const { setSetting, purgeContent } = await import('@agent-usage/db');
    const body = await request.json();

    if (body.privacyMode) {
      setSetting(database.db, 'privacyMode', body.privacyMode);
    }
    let purged: { messages: number; fts: number } | undefined;
    if (body.purgeContent) {
      purged = purgeContent(database.sqlite);
    }

    return NextResponse.json({ ok: true, purged });
  } catch (e) {
    console.error('API /privacy POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
