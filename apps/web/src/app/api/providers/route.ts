import os from 'node:os';
import { NextResponse } from 'next/server';
import { getCore, getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

/**
 * Replace the user's home directory prefix with `~` for display.
 * Works across macOS, Linux, and Windows: `os.homedir()` returns the
 * platform-native home (`/Users/x`, `/home/x`, `C:\Users\x`), and we match
 * either path separator so a Windows `C:\Users\x\.codex` shortens too.
 */
function abbreviateHome(p: string, home: string): string {
  if (!p || !home) return p;
  const root = home.replace(/[\\/]+$/, '');
  if (p === root) return '~';
  if (p.startsWith(`${root}/`) || p.startsWith(`${root}\\`)) {
    return `~${p.slice(root.length)}`;
  }
  return p;
}

export async function GET() {
  try {
    const core = await getCore();
    const { loadConfig } = core;
    const { detectAgentInstallations } = await import('@agent-usage/parsers');
    const {
      getProviderUsageStats,
      getLastScanByProvider,
      getParserWarnings,
      getScanRuns,
    } = await import('@agent-usage/db');
    const database = await getDb();
    const config = loadConfig();

    const home = os.homedir();
    const agents = detectAgentInstallations(config);
    const stats = getProviderUsageStats(database.db);
    const statsByProvider = new Map(stats.map((s) => [s.provider, s]));
    const lastScans = getLastScanByProvider(database.db);
    const recentWarnings = getParserWarnings(database.db, { limit: 50 });
    const latestScan = getScanRuns(database.db, 1)[0] ?? null;

    const merged = agents.map((agent) => {
      const usage = statsByProvider.get(agent.provider) ?? null;
      const lastScan =
        lastScans.get(agent.provider) ?? lastScans.get('__all__') ?? null;
      const warnings = recentWarnings.filter((w) =>
        w.file.toLowerCase().includes(agent.provider),
      );

      return {
        ...agent,
        path: abbreviateHome(agent.path, home),
        sessionPatterns: agent.sessionPatterns.map((p) => abbreviateHome(p, home)),
        usage,
        lastScan: lastScan
          ? {
              completedAt: lastScan.completedAt,
              filesScanned: lastScan.filesScanned,
              sessionsFound: lastScan.sessionsFound,
              warningsCount: lastScan.warningsCount,
            }
          : null,
        warnings: warnings.slice(0, 5),
      };
    });

    return NextResponse.json({ agents: merged, latestScan });
  } catch (e) {
    console.error('API /providers error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
