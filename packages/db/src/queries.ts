import { eq, and, gte, lte, desc, sql, asc } from 'drizzle-orm';
import type { AppDatabase } from './connection.js';
import * as schema from './schema.js';
import type { Provider, NormalizedSession, StatsSummary, PricingSource, ProviderSupportLevel, UsageConfidence } from '@agent-usage/shared';
import { normalizeTokenTotals } from '@agent-usage/shared';

function sessionRowValues(session: NormalizedSession, fileHash: string) {
  const totals = normalizeTokenTotals(session.totals);
  const messageCount = session.messageCount ?? session.messages.length;
  const promptCount =
    session.promptCount ?? session.messages.filter((m) => m.role === 'user').length;

  return {
    provider: session.provider,
    fileHash,
    sourcePath: session.sourcePath,
    storageKind: session.storageKind,
    supportLevel: session.supportLevel,
    usageConfidence: session.usageConfidence,
    projectPath: session.projectPath,
    projectName: session.projectName,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt || new Date().toISOString(),
    messageCount,
    promptCount,
    sessionWarnings: session.warnings?.length
      ? JSON.stringify(session.warnings)
      : undefined,
    rawRetention: session.rawRetention,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    cacheReadTokens: totals.cacheReadTokens,
    toolTokens: totals.toolTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    tokenUsageEstimated: session.tokenUsageEstimated ?? false,
    recordedCost: session.costs?.recordedCost,
    simulatedCost: session.costs?.simulatedCost,
    pricingSource: session.costs?.pricingSource,
    costEstimated: session.costs?.estimated ?? false,
    model: session.messages.find((m) => m.model)?.model,
    metadata: session.metadata ? JSON.stringify(session.metadata) : undefined,
  };
}

export function upsertSession(db: AppDatabase['db'], session: NormalizedSession, fileHash: string) {
  // Upsert by primary key (the provider's stable session id) so a single file
  // containing multiple sessions is ingested correctly and re-scans are
  // idempotent. The file hash is recorded for provenance/change detection.
  const row = sessionRowValues(session, fileHash);
  const existing = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, session.id))
    .get();

  if (existing) {
    db.update(schema.sessions)
      .set(row)
      .where(eq(schema.sessions.id, existing.id))
      .run();
    return existing.id;
  }

  const id = session.id;
  db.insert(schema.sessions)
    .values({
      id,
      ...row,
      createdAt: new Date().toISOString(),
    })
    .run();

  return id;
}

export function updateSessionCosts(
  db: AppDatabase['db'],
  sessionId: string,
  data: {
    estimatedCost: number;
    simulatedCost: number;
    model: string;
    costEstimated: boolean;
    recordedCost?: number;
    pricingSource?: PricingSource;
  },
) {
  db.update(schema.sessions)
    .set({
      estimatedCost: data.estimatedCost,
      simulatedCost: data.simulatedCost,
      model: data.model,
      costEstimated: data.costEstimated,
      recordedCost: data.recordedCost,
      pricingSource: data.pricingSource,
    })
    .where(eq(schema.sessions.id, sessionId))
    .run();
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
    const contentHidden =
      msg.contentHidden ?? (msg.contentPreview.startsWith('[') && !msg.contentText);
    db.insert(schema.messages)
      .values({
        id: msg.id,
        sessionId,
        timestamp: msg.timestamp,
        role: msg.role,
        model: msg.model,
        contentText: msg.contentText,
        contentPreview: msg.contentPreview,
        contentHidden,
        inputTokens: msg.inputTokens,
        outputTokens: msg.outputTokens,
        cachedInputTokens: msg.cachedInputTokens,
        cacheCreationTokens: msg.cacheCreationTokens,
        cacheReadTokens: msg.cacheReadTokens,
        toolTokens: msg.toolTokens,
        reasoningTokens: msg.reasoningTokens,
        usageConfidence: msg.usageConfidence,
        recordedCost: msg.recordedCost,
        simulatedCost: msg.simulatedCost,
        costEstimated: msg.costEstimated ?? false,
        messageMetadata: msg.metadata ? JSON.stringify(msg.metadata) : undefined,
        toolName: msg.toolName,
        toolInputPreview: msg.toolInputPreview,
        toolOutputPreview: msg.toolOutputPreview,
        raw: msg.raw ? JSON.stringify(msg.raw) : undefined,
        estimatedCost: msg.simulatedCost ?? 0,
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
  warning: { file: string; line?: number; message: string; severity: string; code?: string },
) {
  db.insert(schema.parserWarnings)
    .values({
      scanRunId,
      file: warning.file,
      line: warning.line,
      message: warning.message,
      severity: warning.severity,
      code: warning.code,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export function getScanRuns(db: AppDatabase['db'], limit = 20) {
  return db
    .select()
    .from(schema.scanRuns)
    .orderBy(desc(schema.scanRuns.startedAt))
    .limit(limit)
    .all();
}

export function getParserWarnings(
  db: AppDatabase['db'],
  options?: { scanRunId?: number; limit?: number },
) {
  const conditions = [];
  if (options?.scanRunId != null) {
    conditions.push(eq(schema.parserWarnings.scanRunId, options.scanRunId));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  let query = db.select().from(schema.parserWarnings);
  if (where) query = query.where(where) as typeof query;
  return query
    .orderBy(desc(schema.parserWarnings.createdAt))
    .limit(options?.limit ?? 100)
    .all();
}

export function getSession(db: AppDatabase['db'], sessionId: string) {
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .get();
}

export function getSessions(
  db: AppDatabase['db'],
  options?: {
    provider?: Provider;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'date' | 'cost' | 'tokens' | 'provider' | 'model';
    usageConfidence?: UsageConfidence;
  },
) {
  const conditions = [];
  if (options?.provider) conditions.push(eq(schema.sessions.provider, options.provider));
  if (options?.from) conditions.push(gte(schema.sessions.updatedAt, options.from));
  if (options?.to) conditions.push(lte(schema.sessions.updatedAt, options.to));
  if (options?.usageConfidence) {
    conditions.push(eq(schema.sessions.usageConfidence, options.usageConfidence));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const orderCol =
    options?.orderBy === 'cost'
      ? desc(schema.sessions.estimatedCost)
      : options?.orderBy === 'tokens'
        ? desc(schema.sessions.totalTokens)
        : options?.orderBy === 'provider'
          ? asc(schema.sessions.provider)
          : options?.orderBy === 'model'
            ? asc(schema.sessions.model)
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

/** Monday (ISO) start date for the week containing `dateStr` (YYYY-MM-DD). */
function weekStartDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = d.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

export type WeeklyUsageRow = {
  week: string;
  provider: string;
  model: string;
  projectName: string;
  sessions: number;
  prompts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

/** Aggregate daily rollups into ISO weeks (Monday start). */
export function getWeeklyUsage(
  db: AppDatabase['db'],
  options?: { from?: string; to?: string; provider?: Provider },
): WeeklyUsageRow[] {
  const daily = getDailyUsage(db, options);
  const grouped = new Map<string, WeeklyUsageRow>();

  for (const row of daily) {
    const week = weekStartDate(row.date);
    const key = `${week}|${row.provider}|${row.model}|${row.projectName}`;
    const sessions = row.sessions ?? 0;
    const prompts = row.prompts ?? 0;
    const inputTokens = row.inputTokens ?? 0;
    const outputTokens = row.outputTokens ?? 0;
    const cachedInputTokens = row.cachedInputTokens ?? 0;
    const reasoningTokens = row.reasoningTokens ?? 0;
    const totalTokens = row.totalTokens ?? 0;
    const estimatedCost = row.estimatedCost ?? 0;
    const existing = grouped.get(key);
    if (existing) {
      existing.sessions += sessions;
      existing.prompts += prompts;
      existing.inputTokens += inputTokens;
      existing.outputTokens += outputTokens;
      existing.cachedInputTokens += cachedInputTokens;
      existing.reasoningTokens += reasoningTokens;
      existing.totalTokens += totalTokens;
      existing.estimatedCost += estimatedCost;
    } else {
      grouped.set(key, {
        week,
        provider: row.provider,
        model: row.model ?? 'unknown',
        projectName: row.projectName ?? 'Unknown',
        sessions,
        prompts,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens,
        totalTokens,
        estimatedCost,
      });
    }
  }

  return [...grouped.values()].sort((a, b) => a.week.localeCompare(b.week));
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

  const qualityWhere = where;
  const costEstimatedSessions =
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sessions)
      .where(
        qualityWhere
          ? and(qualityWhere, eq(schema.sessions.costEstimated, true))
          : eq(schema.sessions.costEstimated, true),
      )
      .get()?.count ?? 0;

  const tokenEstimatedSessions =
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sessions)
      .where(
        qualityWhere
          ? and(qualityWhere, eq(schema.sessions.tokenUsageEstimated, true))
          : eq(schema.sessions.tokenUsageEstimated, true),
      )
      .get()?.count ?? 0;

  const supportRows = db
    .select({
      level: schema.sessions.supportLevel,
      count: sql<number>`count(*)`,
    })
    .from(schema.sessions)
    .where(qualityWhere)
    .groupBy(schema.sessions.supportLevel)
    .all();

  const confidenceRows = db
    .select({
      confidence: schema.sessions.usageConfidence,
      count: sql<number>`count(*)`,
    })
    .from(schema.sessions)
    .where(qualityWhere)
    .groupBy(schema.sessions.usageConfidence)
    .all();

  const sessionsBySupportLevel: Partial<Record<ProviderSupportLevel, number>> = {};
  for (const row of supportRows) {
    if (row.level) {
      sessionsBySupportLevel[row.level as ProviderSupportLevel] = row.count;
    }
  }

  const sessionsByUsageConfidence: Partial<Record<UsageConfidence, number>> = {};
  for (const row of confidenceRows) {
    if (row.confidence) {
      sessionsByUsageConfidence[row.confidence as UsageConfidence] = row.count;
    }
  }

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
    costEstimatedSessions,
    tokenEstimatedSessions,
    sessionsBySupportLevel,
    sessionsByUsageConfidence,
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
  sessions: number;
} {
  const messagesResult = sqlite
    .prepare(
      "UPDATE messages SET content_text = NULL, raw = NULL, message_metadata = NULL, tool_input_preview = NULL, tool_output_preview = NULL, content_preview = '[purged]'",
    )
    .run();
  const sessionsResult = sqlite
    .prepare('UPDATE sessions SET metadata = NULL WHERE metadata IS NOT NULL')
    .run();
  let fts = 0;
  try {
    fts = sqlite.prepare('DELETE FROM messages_fts').run().changes;
  } catch {
    // FTS unavailable.
  }
  return { messages: messagesResult.changes, fts, sessions: sessionsResult.changes };
}

/** Aggregate session/usage stats grouped by provider (for the Providers page). */
export function getProviderUsageStats(db: AppDatabase['db']) {
  return db
    .select({
      provider: schema.sessions.provider,
      sessions: sql<number>`count(*)`,
      sessionsWithTokens: sql<number>`sum(case when ${schema.sessions.totalTokens} > 0 then 1 else 0 end)`,
      exactUsageSessions: sql<number>`sum(case when ${schema.sessions.usageConfidence} = 'exact' then 1 else 0 end)`,
      metadataOnlySessions: sql<number>`sum(case when ${schema.sessions.usageConfidence} = 'metadata-only' then 1 else 0 end)`,
      estimatedSessions: sql<number>`sum(case when ${schema.sessions.costEstimated} = 1 then 1 else 0 end)`,
      totalTokens: sql<number>`coalesce(sum(${schema.sessions.totalTokens}), 0)`,
      totalCost: sql<number>`coalesce(sum(${schema.sessions.estimatedCost}), 0)`,
      lastSeen: sql<string>`max(coalesce(${schema.sessions.updatedAt}, ${schema.sessions.startedAt}, ${schema.sessions.createdAt}))`,
    })
    .from(schema.sessions)
    .groupBy(schema.sessions.provider)
    .all();
}

export function getLastScanByProvider(db: AppDatabase['db']) {
  const rows = db
    .select()
    .from(schema.scanRuns)
    .where(eq(schema.scanRuns.status, 'completed'))
    .orderBy(desc(schema.scanRuns.completedAt))
    .all();

  const byProvider = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = row.provider ?? '__all__';
    if (!byProvider.has(key)) byProvider.set(key, row);
  }
  return byProvider;
}

export function getScanRun(db: AppDatabase['db'], runId: number) {
  return db
    .select()
    .from(schema.scanRuns)
    .where(eq(schema.scanRuns.id, runId))
    .get();
}

export function updateScanRunProgress(
  db: AppDatabase['db'],
  runId: number,
  data: { filesScanned?: number; sessionsFound?: number; messagesFound?: number },
) {
  db.update(schema.scanRuns)
    .set({
      filesScanned: data.filesScanned,
      sessionsFound: data.sessionsFound,
      messagesFound: data.messagesFound,
    })
    .where(eq(schema.scanRuns.id, runId))
    .run();
}

export type PromptListRow = {
  id: string;
  sessionId: string;
  timestamp: string | null;
  role: string;
  model: string | null;
  contentPreview: string;
  contentHidden: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  simulatedCost: number | null;
  usageConfidence: string | null;
  provider: string;
  projectName: string | null;
  supportLevel: string | null;
};

export function listUserPrompts(
  db: AppDatabase['db'],
  options?: {
    provider?: Provider;
    model?: string;
    project?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
) {
  const conditions = [eq(schema.messages.role, 'user')];
  if (options?.provider) conditions.push(eq(schema.sessions.provider, options.provider));
  if (options?.model) conditions.push(eq(schema.messages.model, options.model));
  if (options?.project) conditions.push(eq(schema.sessions.projectName, options.project));
  if (options?.from) conditions.push(gte(schema.messages.timestamp, options.from));
  if (options?.to) conditions.push(lte(schema.messages.timestamp, options.to));

  const where = and(...conditions);

  let query = db
    .select({
      id: schema.messages.id,
      sessionId: schema.messages.sessionId,
      timestamp: schema.messages.timestamp,
      role: schema.messages.role,
      model: schema.messages.model,
      contentPreview: schema.messages.contentPreview,
      contentHidden: schema.messages.contentHidden,
      inputTokens: schema.messages.inputTokens,
      outputTokens: schema.messages.outputTokens,
      simulatedCost: schema.messages.simulatedCost,
      usageConfidence: schema.messages.usageConfidence,
      provider: schema.sessions.provider,
      projectName: schema.sessions.projectName,
      supportLevel: schema.sessions.supportLevel,
    })
    .from(schema.messages)
    .innerJoin(schema.sessions, eq(schema.messages.sessionId, schema.sessions.id))
    .where(where)
    .orderBy(desc(schema.messages.timestamp));

  if (options?.limit) query = query.limit(options.limit) as typeof query;
  if (options?.offset) query = query.offset(options.offset) as typeof query;

  return query.all() as PromptListRow[];
}

export type GroupByDimension = 'provider' | 'model' | 'project' | 'role';
export type UsageMetric =
  | 'tokens'
  | 'input'
  | 'output'
  | 'cached'
  | 'reasoning'
  | 'cost'
  | 'prompts'
  | 'sessions';

export type GroupedUsageRow = { label: string; value: number };

function metricFromDailyRow(
  row: typeof schema.usageDaily.$inferSelect,
  metric: UsageMetric,
): number {
  switch (metric) {
    case 'input':
      return row.inputTokens ?? 0;
    case 'output':
      return row.outputTokens ?? 0;
    case 'cached':
      return row.cachedInputTokens ?? 0;
    case 'reasoning':
      return row.reasoningTokens ?? 0;
    case 'cost':
      return row.estimatedCost ?? 0;
    case 'prompts':
      return row.prompts ?? 0;
    case 'sessions':
      return row.sessions ?? 0;
    default:
      return row.totalTokens ?? 0;
  }
}

/** Aggregate rollup rows by provider/model/project for dashboard charts. */
export function getGroupedUsage(
  db: AppDatabase['db'],
  options: {
    groupBy: GroupByDimension;
    metric: UsageMetric;
    from?: string;
    to?: string;
    provider?: Provider;
    usageConfidence?: UsageConfidence;
  },
): GroupedUsageRow[] {
  if (options.groupBy === 'role') {
    const conditions = [];
    if (options.provider) conditions.push(eq(schema.sessions.provider, options.provider));
    if (options.from) conditions.push(gte(schema.messages.timestamp, options.from));
    if (options.to) conditions.push(lte(schema.messages.timestamp, options.to));
    if (options.usageConfidence) {
      conditions.push(eq(schema.sessions.usageConfidence, options.usageConfidence));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const metricSql =
      options.metric === 'cost'
        ? sql<number>`coalesce(sum(${schema.messages.simulatedCost}), 0)`
        : options.metric === 'input'
          ? sql<number>`coalesce(sum(${schema.messages.inputTokens}), 0)`
          : options.metric === 'output'
            ? sql<number>`coalesce(sum(${schema.messages.outputTokens}), 0)`
            : options.metric === 'cached'
              ? sql<number>`coalesce(sum(${schema.messages.cachedInputTokens}), 0)`
              : options.metric === 'reasoning'
                ? sql<number>`coalesce(sum(${schema.messages.reasoningTokens}), 0)`
                : options.metric === 'prompts'
                  ? sql<number>`count(*)`
                  : options.metric === 'sessions'
                    ? sql<number>`count(distinct ${schema.messages.sessionId})`
                    : sql<number>`coalesce(sum(coalesce(${schema.messages.inputTokens}, 0) + coalesce(${schema.messages.outputTokens}, 0)), 0)`;

    const rows = db
      .select({
        label: schema.messages.role,
        value: metricSql,
      })
      .from(schema.messages)
      .innerJoin(schema.sessions, eq(schema.messages.sessionId, schema.sessions.id))
      .where(where)
      .groupBy(schema.messages.role)
      .orderBy(desc(metricSql))
      .all();

    return rows.map((r) => ({ label: r.label || 'unknown', value: r.value ?? 0 }));
  }

  const daily = getDailyUsage(db, {
    from: options.from,
    to: options.to,
    provider: options.provider,
  });

  const grouped = new Map<string, number>();
  for (const row of daily) {
    const label =
      options.groupBy === 'provider'
        ? row.provider
        : options.groupBy === 'model'
          ? row.model || 'unknown'
          : row.projectName || 'Unknown';
    grouped.set(label, (grouped.get(label) ?? 0) + metricFromDailyRow(row, options.metric));
  }

  return [...grouped.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

export function getPricingProfiles(db: AppDatabase['db']) {
  return db
    .selectDistinct({ profile: schema.pricingModels.profile })
    .from(schema.pricingModels)
    .orderBy(asc(schema.pricingModels.profile))
    .all()
    .map((r) => r.profile ?? 'api-standard');
}

export function clonePricingProfile(
  db: AppDatabase['db'],
  sourceProfile: string,
  targetProfile: string,
) {
  const source = getPricingModels(db, sourceProfile);
  let cloned = 0;
  for (const model of source) {
    const existing = db
      .select()
      .from(schema.pricingModels)
      .where(
        and(
          eq(schema.pricingModels.provider, model.provider),
          eq(schema.pricingModels.model, model.model),
          eq(schema.pricingModels.profile, targetProfile),
        ),
      )
      .get();
    if (existing) continue;

    const now = new Date().toISOString();
    db.insert(schema.pricingModels)
      .values({
        provider: model.provider,
        model: model.model,
        currency: model.currency,
        inputPerMillion: model.inputPerMillion,
        outputPerMillion: model.outputPerMillion,
        cachedInputPerMillion: model.cachedInputPerMillion,
        cacheWritePerMillion: model.cacheWritePerMillion,
        reasoningPerMillion: model.reasoningPerMillion,
        profile: targetProfile,
        notes: model.notes,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    cloned++;
  }
  return cloned;
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

/** Returns true when a file's hash and mtime match the last successful scan. */
export function isFileUnchanged(
  sqlite: AppDatabase['sqlite'],
  filePath: string,
  fileHash: string,
  mtimeMs: number,
): boolean {
  try {
    const row = sqlite
      .prepare('SELECT file_hash, mtime_ms FROM scanned_files WHERE path = ?')
      .get(filePath) as { file_hash: string; mtime_ms: number } | undefined;
    return Boolean(row && row.file_hash === fileHash && row.mtime_ms === mtimeMs);
  } catch {
    return false;
  }
}

export function markFileScanned(
  sqlite: AppDatabase['sqlite'],
  filePath: string,
  fileHash: string,
  mtimeMs: number,
): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO scanned_files (path, file_hash, mtime_ms, last_scanned_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         file_hash = excluded.file_hash,
         mtime_ms = excluded.mtime_ms,
         last_scanned_at = excluded.last_scanned_at`,
    )
    .run(filePath, fileHash, mtimeMs, now);
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
