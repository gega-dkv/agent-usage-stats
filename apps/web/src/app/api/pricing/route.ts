import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const database = await getDb();
    const { getPricingModels, upsertPricingModel } = await import('@agent-usage/db');
    const { getDefaultPricingModels } = await import('@agent-usage/pricing');
    let models = getPricingModels(database.db);
    if (models.length === 0) {
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
      models = getPricingModels(database.db);
    }
    return NextResponse.json({ models });
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
    const { upsertPricingModel } = await import('@agent-usage/db');
    const body = await request.json();

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
