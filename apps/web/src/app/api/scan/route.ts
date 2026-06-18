import { NextResponse } from 'next/server';
import { getDb, getCore } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const provider = body.provider === 'all'
      ? undefined
      : body.provider as 'claude' | 'codex' | 'gemini' | undefined;
    const paths = body.paths as string[] | undefined;

    const database = await getDb();
    const core = await getCore();
    const config = core.loadConfig();

    const result = await core.scanSessions(database, config, { provider, paths });

    return NextResponse.json(result);
  } catch (e) {
    console.error('API /scan error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
