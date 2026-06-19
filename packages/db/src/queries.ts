import { eq, and, gte, lte, desc, sql, asc } from 'drizzle-orm';
import type { AppDatabase } from './connection.js';
import * as schema from './schema.js';
import type { Provider, NormalizedSession, StatsSummary } from '@agent-usage/shared';

export function upsertSession(db: AppDatabase['db'], session: NormalizedSession, fileHash: string) {
  // Upsert by primary key (the provider's stable session id) so a single file
  // containing multiple sessions is ingested correctly and re-scans are
  // idempotent. The file hash is recorded for provenance/change detection.
  const existing = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, session.id))
    .get();

  if (existing) {
    db.update(schema.sessions)
      .set({
        fileHash,
        updatedAt: session.updatedAt || new Date().toISOString(),
        inputTokens: session.totals.inputTokens,
        outputTokens: session.totals.outputTokens,
        cachedInputTokens: session.totals.cachedInputTokens,
        reasoningTokens: session.totals.reasoningTokens,
        totalTokens: session.totals.totalTokens,
      })
      .where(eq(schema.sessions.id, existing.id))
      .run();
    return existing.id;
  }

  const id = session.id;
  db.insert(schema.sessions)
    .values({
      id,
      provider: session.provider,
      fileHash,
      projectPath: session.projectPath,
      projectName: session.projectName,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      inputTokens: session.totals.inputTokens,
      outputTokens: session.totals.outputTokens,
      cachedInputTokens: session.totals.cachedInputTokens,
      reasoningTokens: session.totals.reasoningTokens,
      totalTokens: session.totals.totalTokens,
      model: session.messages[0]?.model,
      metadata: session.metadata ? JSON.stringify(session.metadata) : undefined,
      createdAt: new Date().toISOString(),
    })
    .run();

  return id;
}

export function upsertMessages(
  db: AppDatabase['db'],
  sessionId: string,
  messages: NormalizedSession['messages'],
) {
  // Delete existing messages for this session first
  db.delete(schema.messages).where(eq(schema.messages.sessionId, sessionId)).run();
  // Keep the FTS index in sync (best-effort — table may not exist).
  try {
    db.run(sql`DELETE FROM messages_fts WHERE session_id = ${sessionId}`);
  } catch {
    // FTS unavailable.
  }

  for (const msg of messages) {
    db.insert(schema.messages)
      .values({
        id: msg.id,
        sessionId,
        timestamp: msg.timestamp,
        role: msg.role,
        model: msg.model,
        contentText: msg.contentText,
        contentPreview: msg.contentPreview,
        inputTokens: msg.inputTokens,
        outputTokens: msg.outputTokens,
        cachedInputTokens: msg.cachedInputTokens,
        reasoningTokens: msg.reasoningTokens,
        toolName: msg.toolName,
        toolInputPreview: msg.toolInputPreview,
        toolOutputPreview: msg.toolOutputPreview,
        raw: msg.raw ? JSON.stringify(msg.raw) : undefined,
      })
      .run();

    // Only index real content (omitted under privacy mode `disabled`).
    if (msg.contentText) {
      try {
        db.run(
          sql`INSERT INTO messages_fts (message_id, session_id, content) VALUES (${msg.id}, ${sessionId}, ${msg.contentText})`,
        );
      } catch {
        // FTS unavailable.
      }
    }
  }
}

export function insertScanRun(
  db: AppDatabase['db'],
  data: {
    status: string;
    provider?: string;
    filesScanned?: number;
    sessionsFound?: number;
    messagesFound?: number;
    warningsCount?: number;
    errors?: string;
  },
) {
  const now = new Date().toISOString();
  const result = db
    .insert(schema.scanRuns)
    .values({
      startedAt: now,
      completedAt: data.status === 'completed' ? now : undefined,
      status: data.status,
      provider: data.provider,
      filesScanned: data.filesScanned || 0,
      sessionsFound: data.sessionsFound || 0,
      messagesFound: data.messagesFound || 0,
      warningsCount: data.warningsCount || 0,
      errors: data.errors,
    })
    .run();
  return result.lastInsertRowid;
}

export function insertParserWarning(
  db: AppDatabase['db'],
  scanRunId: number,
  warning: { file: string; line?: number; message: string; severity: string },
) {
  db.insert(schema.parserWarnings)
    .values({
      scanRunId,
      file: warning.file,
      line: warning.line,
      message: warning.message,
      severity: warning.severity,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function getSessions(
  db: AppDatabase['db'],
  options?: {
    provider?: Provider;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'date' | 'cost' | 'tokens';
  },
) {
  const conditions = [];
  if (options?.provider) conditions.push(eq(schema.sessions.provider, options.provider));
  if (options?.from) conditions.push(gte(schema.sessions.updatedAt, options.from));
  if (options?.to) conditions.push(lte(schema.sessions.updatedAt, options.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol =
    options?.orderBy === 'cost'
      ? desc(schema.sessions.estimatedCost)
      : options?.orderBy === 'tokens'
        ? desc(schema.sessions.totalTokens)
        : desc(schema.sessions.updatedAt);

  let query: any = db.select().from(schema.sessions);
  if (where) query = query.where(where);
  query = query.orderBy(orderCol);
  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.offset(options.offset);

  return query.all() as any[];
}

export function getSessionMessages(db: AppDatabase['db'], sessionId: string) {
  return db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId))
    .orderBy(asc(schema.messages.timestamp))
    .all();
}

export function getDailyUsage(
  db: AppDatabase['db'],
  options?: { from?: string; to?: string; provider?: Provider },
) {
  const conditions = [];
  if (options?.from) conditions.push(gte(schema.usageDaily.date, options.from));
  if (options?.to) conditions.push(lte(schema.usageDaily.date, options.to));
  if (options?.provider) conditions.push(eq(schema.usageDaily.provider, options.provider));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(schema.usageDaily)
    .where(where)
    .orderBy(asc(schema.usageDaily.date))
    .all();
}

export function getMonthlyUsage(
  db: AppDatabase['db'],
  options?: { from?: string; to?: string; provider?: Provider },
) {
  const conditions = [];
  if (options?.from) conditions.push(gte(schema.usageMonthly.month, options.from));
  if (options?.to) conditions.push(lte(schema.usageMonthly.month, options.to));
  if (options?.provider) conditions.push(eq(schema.usageMonthly.provider, options.provider));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(schema.usageMonthly)
    .where(where)
    .orderBy(asc(schema.usageMonthly.month))
    .all();
}

export function getYearlyUsage(
  db: AppDatabase['db'],
  options?: { from?: string; to?: string; provider?: Provider },
) {
  const conditions = [];
  if (options?.from) conditions.push(gte(schema.usageYearly.year, options.from));
  if (options?.to) conditions.push(lte(schema.usageYearly.year, options.to));
  if (options?.provider) conditions.push(eq(schema.usageYearly.provider, options.provider));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(schema.usageYearly)
    .where(where)
    .orderBy(asc(schema.usageYearly.year))
    .all();
}

export function getStatsSummary(db: AppDatabase['db'], options?: { from?: string; to?: string }) {
  const conditions = [];
  if (options?.from) conditions.push(gte(schema.sessions.updatedAt, options.from));
  if (options?.to) conditions.push(lte(schema.sessions.updatedAt, options.to));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totals = db
    .select({
      sessions: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${schema.sessions.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${schema.sessions.outputTokens}), 0)`,
      cachedTokens: sql<number>`coalesce(sum(${schema.sessions.cachedInputTokens}), 0)`,
      reasoningTokens: sql<number>`coalesce(sum(${schema.sessions.reasoningTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${schema.sessions.totalTokens}), 0)`,
      estimatedCost: sql<number>`coalesce(sum(${schema.sessions.estimatedCost}), 0)`,
    })
    .from(schema.sessions)
    .where(where)
    .get() ?? {
    sessions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };

  const promptCount = db
    .select({ count: sql<number>`count(*)` })
    .from(schema.messages)
    .where(eq(schema.messages.role, 'user'))
    .get() ?? { count: 0 };

  const topModel = db
    .select({
      model: schema.sessions.model,
      cost: sql<number>`sum(${schema.sessions.estimatedCost})`,
    })
    .from(schema.sessions)
    .where(where)
    .groupBy(schema.sessions.model)
    .orderBy(desc(sql<number>`sum(${schema.sessions.estimatedCost})`))
    .limit(1)
    .get();

  const topDay = db
    .select({
      date: sql<string>`date(${schema.sessions.updatedAt})`,
      cost: sql<number>`sum(${schema.sessions.estimatedCost})`,
    })
    .from(schema.sessions)
    .where(where)
    .groupBy(sql`date(${schema.sessions.updatedAt})`)
    .orderBy(desc(sql<number>`sum(${schema.sessions.estimatedCost})`))
    .limit(1)
    .get();

  const topProjects = db
    .select({
      name: schema.sessions.projectName,
      cost: sql<number>`sum(${schema.sessions.estimatedCost})`,
      sessions: sql<number>`count(*)`,
    })
    .from(schema.sessions)
    .where(where)
    .groupBy(schema.sessions.projectName)
    .orderBy(desc(sql<number>`sum(${schema.sessions.estimatedCost})`))
    .limit(10)
    .all();

  return {
    totalSessions: totals.sessions,
    totalPrompts: promptCount.count,
    totalInputTokens: totals.inputTokens,
    totalOutputTokens: totals.outputTokens,
    totalCachedTokens: totals.cachedTokens,
    totalReasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    totalEstimatedCost: totals.estimatedCost,
    mostExpensiveModel: topModel?.model || 'unknown',
    mostExpensiveDay: topDay?.date || 'N/A',
    topProjects: topProjects.map((p) => ({
      name: p.name || 'Unknown',
      cost: p.cost,
      sessions: p.sessions,
    })),
  } satisfies StatsSummary;
}

/** Turn a free-text query into a safe FTS5 MATCH expression (AND of terms). */
function toFtsMatch(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '')}"`)
    .join(' ');
}

export function searchMessages(
  db: AppDatabase['db'],
  query: string,
  options?: { provider?: Provider; limit?: number },
) {
  const limit = options?.limit || 50;

  const select = () => {
    const base = db
      .select({
        id: schema.messages.id,
        sessionId: schema.messages.sessionId,
        timestamp: schema.messages.timestamp,
        role: schema.messages.role,
        model: schema.messages.model,
        contentPreview: schema.messages.contentPreview,
        inputTokens: schema.messages.inputTokens,
        outputTokens: schema.messages.outputTokens,
        provider: schema.sessions.provider,
        projectName: schema.sessions.projectName,
      })
      .from(schema.messages)
      .innerJoin(schema.sessions, eq(schema.messages.sessionId, schema.sessions.id));
    return base;
  };

  // Prefer FTS5 when the virtual table exists and has matching rows.
  const match = toFtsMatch(query);
  if (match) {
    try {
      const conditions = [
        sql`${schema.messages.id} IN (SELECT message_id FROM messages_fts WHERE messages_fts MATCH ${match})`,
      ];
      if (options?.provider) conditions.push(eq(schema.sessions.provider, options.provider));

      const ftsResults = select()
        .where(and(...conditions))
        .orderBy(desc(schema.messages.timestamp))
        .limit(limit)
        .all();

      if (ftsResults.length > 0) return ftsResults;
    } catch {
      // FTS unavailable or query rejected — fall through to LIKE.
    }
  }

  const conditions = [
    sql`(${schema.messages.contentText} LIKE ${`%${query}%`} OR ${schema.messages.contentPreview} LIKE ${`%${query}%`})`,
  ];
  if (options?.provider) conditions.push(eq(schema.sessions.provider, options.provider));

  return select()
    .where(and(...conditions))
    .orderBy(desc(schema.messages.timestamp))
    .limit(limit)
    .all();
}

/** Permanently clear all stored content + raw records; returns rows affected. */
export function purgeContent(sqlite: AppDatabase['sqlite']): {
  messages: number;
  fts: number;
} {
  const messagesResult = sqlite
    .prepare(
      "UPDATE messages SET content_text = NULL, raw = NULL, tool_input_preview = NULL, tool_output_preview = NULL, content_preview = '[purged]'",
    )
    .run();
  let fts = 0;
  try {
    fts = sqlite.prepare('DELETE FROM messages_fts').run().changes;
  } catch {
    // FTS unavailable.
  }
  return { messages: messagesResult.changes, fts };
}

/** Aggregate session/usage stats grouped by provider (for the Providers page). */
export function getProviderUsageStats(db: AppDatabase['db']) {
  return db
    .select({
      provider: schema.sessions.provider,
      sessions: sql<number>`count(*)`,
      sessionsWithTokens: sql<number>`sum(case when ${schema.sessions.totalTokens} > 0 then 1 else 0 end)`,
      estimatedSessions: sql<number>`sum(case when ${schema.sessions.costEstimated} = 1 then 1 else 0 end)`,
      totalTokens: sql<number>`coalesce(sum(${schema.sessions.totalTokens}), 0)`,
      totalCost: sql<number>`coalesce(sum(${schema.sessions.estimatedCost}), 0)`,
      lastSeen: sql<string>`max(coalesce(${schema.sessions.updatedAt}, ${schema.sessions.startedAt}, ${schema.sessions.createdAt}))`,
    })
    .from(schema.sessions)
    .groupBy(schema.sessions.provider)
    .all();
}

export function getPricingModels(db: AppDatabase['db'], profile?: string) {
  const conditions = profile ? [eq(schema.pricingModels.profile, profile)] : [];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select()
    .from(schema.pricingModels)
    .where(where)
    .orderBy(asc(schema.pricingModels.provider), asc(schema.pricingModels.model))
    .all();
}

export function upsertPricingModel(
  db: AppDatabase['db'],
  data: {
    provider: string;
    model: string;
    inputPerMillion: number;
    outputPerMillion: number;
    cachedInputPerMillion?: number;
    cacheWritePerMillion?: number;
    reasoningPerMillion?: number;
    profile?: string;
    notes?: string;
    isDefault?: boolean;
  },
) {
  const existing = db
    .select()
    .from(schema.pricingModels)
    .where(
      and(
        eq(schema.pricingModels.provider, data.provider),
        eq(schema.pricingModels.model, data.model),
        eq(schema.pricingModels.profile, data.profile || 'api-standard'),
      ),
    )
    .get();

  const now = new Date().toISOString();

  if (existing) {
    db.update(schema.pricingModels)
      .set({
        inputPerMillion: data.inputPerMillion,
        outputPerMillion: data.outputPerMillion,
        cachedInputPerMillion: data.cachedInputPerMillion,
        cacheWritePerMillion: data.cacheWritePerMillion,
        reasoningPerMillion: data.reasoningPerMillion,
        notes: data.notes,
        isDefault: data.isDefault,
        updatedAt: now,
      })
      .where(eq(schema.pricingModels.id, existing.id))
      .run();
    return existing.id;
  }

  const result = db
    .insert(schema.pricingModels)
    .values({
      provider: data.provider,
      model: data.model,
      inputPerMillion: data.inputPerMillion,
      outputPerMillion: data.outputPerMillion,
      cachedInputPerMillion: data.cachedInputPerMillion,
      cacheWritePerMillion: data.cacheWritePerMillion,
      reasoningPerMillion: data.reasoningPerMillion,
      profile: data.profile || 'api-standard',
      notes: data.notes,
      isDefault: data.isDefault || false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return result.lastInsertRowid;
}

export function getSetting(db: AppDatabase['db'], key: string) {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .get();
  return row?.value;
}

export function setSetting(db: AppDatabase['db'], key: string, value: string) {
  const now = new Date().toISOString();
  const existing = getSetting(db, key);
  if (existing) {
    db.update(schema.settings)
      .set({ value, updatedAt: now })
      .where(eq(schema.settings.key, key))
      .run();
  } else {
    db.insert(schema.settings)
      .values({ key, value, updatedAt: now })
      .run();
  }
}

export function refreshUsageRollups(sqlite: AppDatabase['sqlite']) {
  sqlite.exec(`
    DELETE FROM usage_daily;
    DELETE FROM usage_monthly;
    DELETE FROM usage_yearly;

    WITH prompt_counts AS (
      SELECT session_id, count(*) AS prompts
      FROM messages
      WHERE role = 'user'
      GROUP BY session_id
    )
    INSERT INTO usage_daily (
      date, provider, model, project_name, sessions, prompts,
      input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
      total_tokens, estimated_cost
    )
    SELECT
      date(coalesce(s.updated_at, s.started_at, s.created_at)),
      s.provider,
      coalesce(s.model, 'unknown'),
      coalesce(s.project_name, 'Unknown'),
      count(*),
      coalesce(sum(pc.prompts), 0),
      coalesce(sum(s.input_tokens), 0),
      coalesce(sum(s.output_tokens), 0),
      coalesce(sum(s.cached_input_tokens), 0),
      coalesce(sum(s.reasoning_tokens), 0),
      coalesce(sum(s.total_tokens), 0),
      coalesce(sum(s.estimated_cost), 0)
    FROM sessions s
    LEFT JOIN prompt_counts pc ON pc.session_id = s.id
    WHERE coalesce(s.updated_at, s.started_at, s.created_at) IS NOT NULL
    GROUP BY 1, 2, 3, 4;

    WITH prompt_counts AS (
      SELECT session_id, count(*) AS prompts
      FROM messages
      WHERE role = 'user'
      GROUP BY session_id
    )
    INSERT INTO usage_monthly (
      month, provider, model, project_name, sessions, prompts,
      input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
      total_tokens, estimated_cost
    )
    SELECT
      strftime('%Y-%m', coalesce(s.updated_at, s.started_at, s.created_at)),
      s.provider,
      coalesce(s.model, 'unknown'),
      coalesce(s.project_name, 'Unknown'),
      count(*),
      coalesce(sum(pc.prompts), 0),
      coalesce(sum(s.input_tokens), 0),
      coalesce(sum(s.output_tokens), 0),
      coalesce(sum(s.cached_input_tokens), 0),
      coalesce(sum(s.reasoning_tokens), 0),
      coalesce(sum(s.total_tokens), 0),
      coalesce(sum(s.estimated_cost), 0)
    FROM sessions s
    LEFT JOIN prompt_counts pc ON pc.session_id = s.id
    WHERE coalesce(s.updated_at, s.started_at, s.created_at) IS NOT NULL
    GROUP BY 1, 2, 3, 4;

    WITH prompt_counts AS (
      SELECT session_id, count(*) AS prompts
      FROM messages
      WHERE role = 'user'
      GROUP BY session_id
    )
    INSERT INTO usage_yearly (
      year, provider, model, project_name, sessions, prompts,
      input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
      total_tokens, estimated_cost
    )
    SELECT
      strftime('%Y', coalesce(s.updated_at, s.started_at, s.created_at)),
      s.provider,
      coalesce(s.model, 'unknown'),
      coalesce(s.project_name, 'Unknown'),
      count(*),
      coalesce(sum(pc.prompts), 0),
      coalesce(sum(s.input_tokens), 0),
      coalesce(sum(s.output_tokens), 0),
      coalesce(sum(s.cached_input_tokens), 0),
      coalesce(sum(s.reasoning_tokens), 0),
      coalesce(sum(s.total_tokens), 0),
      coalesce(sum(s.estimated_cost), 0)
    FROM sessions s
    LEFT JOIN prompt_counts pc ON pc.session_id = s.id
    WHERE coalesce(s.updated_at, s.started_at, s.created_at) IS NOT NULL
    GROUP BY 1, 2, 3, 4;
  `);
}
