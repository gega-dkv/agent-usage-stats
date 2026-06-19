import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const database = await getDb();
    const { getSession, getSessionMessages, getParserWarnings } = await import(
      '@agent-usage/db'
    );

    const session = getSession(database.db, id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const messages = getSessionMessages(database.db, id);
    const sourcePath = session.sourcePath ?? '';
    const warnings = getParserWarnings(database.db, { limit: 100 }).filter(
      (w) => w.file === sourcePath || w.file.includes(id),
    );

    let sessionWarnings: unknown[] = [];
    if (session.sessionWarnings) {
      try {
        sessionWarnings = JSON.parse(session.sessionWarnings);
      } catch {
        sessionWarnings = [];
      }
    }

    const conversation = messages.filter((m) => m.role !== 'tool');
    const toolCalls = messages.filter((m) => m.role === 'tool' || m.toolName);

    return NextResponse.json({
      session,
      messages,
      conversation,
      toolCalls,
      warnings,
      sessionWarnings,
    });
  } catch (e) {
    console.error('API /sessions/[id] error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
