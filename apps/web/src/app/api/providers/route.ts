import { NextResponse } from 'next/server';
import { getCore, getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const core = await getCore();
    const { loadConfig } = core;
    const { detectAgentInstallations } = await import('@agent-usage/parsers');
    const { getProviderUsageStats } = await import('@agent-usage/db');
    const database = await getDb();
    const config = loadConfig();

    const agents = detectAgentInstallations(config);
    const stats = getProviderUsageStats(database.db);
    const statsByProvider = new Map(stats.map((s: { provider: string }) => [s.provider, s]));

    const merged = agents.map((agent: { provider: string }) => ({
      ...agent,
      usage: statsByProvider.get(agent.provider) ?? null,
    }));

    return NextResponse.json({ agents: merged });
  } catch (e) {
    console.error('API /providers error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
