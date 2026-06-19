import { NextResponse } from 'next/server';
import { getDb, getCore } from '@/lib/db-server';
import type { AppConfig } from '@agent-usage/shared';
import { listProviders } from '@agent-usage/shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const core = await getCore();
    const database = await getDb();
    const { getSetting } = await import('@agent-usage/db');
    const config = core.loadConfig();
    const privacyMode = getSetting(database.db, 'privacyMode') ?? config.privacyMode;

    const registry = listProviders().map((def) => ({
      id: def.id,
      label: def.label,
      defaultPaths: def.defaultPaths,
      enabled: config.providers[def.id]?.enabled ?? def.enabledByDefault,
      paths: config.providers[def.id]?.paths ?? [],
      supportLevel: def.supportLevel,
    }));

    return NextResponse.json({
      privacyMode,
      currency: config.currency,
      storeRawRecords: config.storeRawRecords,
      estimatePromptOnlySources: config.estimatePromptOnlySources,
      resimulateRecordedCosts: config.resimulateRecordedCosts,
      customPaths: config.customPaths,
      dbPath: config.dbPath,
      providers: registry,
    });
  } catch (e) {
    console.error('API /settings GET error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const core = await getCore();
    const database = await getDb();
    const { setSetting, refreshUsageRollups } = await import('@agent-usage/db');
    const body = await request.json();
    const config = core.loadConfig();

    if (body.privacyMode) {
      setSetting(database.db, 'privacyMode', body.privacyMode);
      config.privacyMode = body.privacyMode;
    }
    if (body.currency != null) config.currency = body.currency;
    if (body.storeRawRecords != null) config.storeRawRecords = Boolean(body.storeRawRecords);
    if (body.estimatePromptOnlySources != null) {
      config.estimatePromptOnlySources = Boolean(body.estimatePromptOnlySources);
    }
    if (body.resimulateRecordedCosts != null) {
      config.resimulateRecordedCosts = Boolean(body.resimulateRecordedCosts);
    }
    if (body.customPaths != null) config.customPaths = body.customPaths;
    if (body.providers != null) {
      for (const [id, value] of Object.entries(body.providers as AppConfig['providers'])) {
        config.providers[id as keyof AppConfig['providers']] = {
          enabled: (value as { enabled?: boolean }).enabled ?? true,
          paths: (value as { paths?: string[] }).paths ?? [],
        };
      }
    }

    const savedPath = core.saveConfig(config);

    if (body.rebuildIndexes) {
      refreshUsageRollups(database.sqlite);
    }

    let scanResult;
    if (body.rescan) {
      scanResult = await core.scanSessions(database, config, { force: true });
    }

    return NextResponse.json({
      ok: true,
      savedPath,
      scanResult,
      rebuilt: Boolean(body.rebuildIndexes),
    });
  } catch (e) {
    console.error('API /settings POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
