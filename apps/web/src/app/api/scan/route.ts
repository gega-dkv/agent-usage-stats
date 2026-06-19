import { NextResponse } from 'next/server';
import { getDb, getCore } from '@/lib/db-server';
import type { Provider } from '@agent-usage/shared';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get('runId');

    const database = await getDb();
    const { getScanRun, getScanRuns } = await import('@agent-usage/db');

    if (runId) {
      const run = getScanRun(database.db, parseInt(runId, 10));
      if (!run) {
        return NextResponse.json({ error: 'Scan run not found' }, { status: 404 });
      }
      return NextResponse.json({ run });
    }

    const latest = getScanRuns(database.db, 1)[0] ?? null;
    return NextResponse.json({ latest });
  } catch (e) {
    console.error('API /scan GET error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const provider =
      body.provider === 'all' ? undefined : (body.provider as Provider | undefined);
    const paths = body.paths as string[] | undefined;
    const asyncScan = body.async !== false;

    const database = await getDb();
    const core = await getCore();
    const config = core.loadConfig();
    const { getScanRuns } = await import('@agent-usage/db');

    const runScan = () =>
      core.scanSessions(database, config, {
        provider,
        paths,
        force: Boolean(body.force),
      });

    if (asyncScan) {
      void runScan().catch((e: unknown) => console.error('Background scan failed:', e));
      await new Promise((r) => setTimeout(r, 50));
      const latest = getScanRuns(database.db, 1)[0];
      return NextResponse.json({
        runId: latest?.id,
        status: latest?.status ?? 'running',
        async: true,
      });
    }

    const result = await runScan();
    const latest = getScanRuns(database.db, 1)[0];
    return NextResponse.json({ ...result, runId: latest?.id, status: 'completed' });
  } catch (e) {
    console.error('API /scan POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
