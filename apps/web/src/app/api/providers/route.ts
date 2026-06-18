import { NextResponse } from 'next/server';
import { getCore } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const core = await getCore();
    const { loadConfig } = core;
    const { detectAgentInstallations } = await import('@agent-usage/parsers');
    const config = loadConfig();

    return NextResponse.json({
      agents: detectAgentInstallations(config),
    });
  } catch (e) {
    console.error('API /providers error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
