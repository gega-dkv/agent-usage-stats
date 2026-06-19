import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const profile = searchParams.get('profile') || undefined;

    const database = await getDb();
    const { getPricingModels, getPricingProfiles, upsertPricingModel } = await import(
      '@agent-usage/db'
    );
    const { getDefaultPricingModels } = await import('@agent-usage/pricing');

    let models = getPricingModels(database.db, profile);
    if (models.length === 0 && !profile) {
      const defaults = getDefaultPricingModels();
      for (const m of defaults) {
        upsertPricingModel(database.db, {
          provider: m.provider,
          model: m.model,
          inputPerMillion: m.inputPerMillion,
          outputPerMillion: m.outputPerMillion,
          cachedInputPerMillion: m.cachedInputPerMillion,
          cacheWritePerMillion: m.cacheWritePerMillion,
          reasoningPerMillion: m.reasoningPerMillion,
          notes: m.notes,
        });
      }
      models = getPricingModels(database.db, profile);
    }

    const profiles = getPricingProfiles(database.db);
    const lastUpdated = models.reduce(
      (max, m) => (m.updatedAt > max ? m.updatedAt : max),
      '',
    );

    return NextResponse.json({ models, profiles, lastUpdated: lastUpdated || null });
  } catch (e) {
    console.error('API /pricing GET error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const database = await getDb();
    const { upsertPricingModel, clonePricingProfile } = await import('@agent-usage/db');
    const body = await request.json();

    if (body.action === 'clone') {
      const count = clonePricingProfile(
        database.db,
        body.sourceProfile || 'api-standard',
        body.targetProfile,
      );
      return NextResponse.json({ ok: true, cloned: count });
    }

    if (Array.isArray(body)) {
      for (const m of body) {
        upsertPricingModel(database.db, m);
      }
      return NextResponse.json({ ok: true, count: body.length });
    }

    upsertPricingModel(database.db, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('API /pricing POST error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
