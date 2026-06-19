import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  paths: text('paths').default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    fileHash: text('file_hash'),
    sourcePath: text('source_path'),
    storageKind: text('storage_kind'),
    supportLevel: text('support_level'),
    usageConfidence: text('usage_confidence'),
    projectPath: text('project_path'),
    projectName: text('project_name'),
    startedAt: text('started_at'),
    updatedAt: text('updated_at'),
    messageCount: integer('message_count').default(0),
    promptCount: integer('prompt_count').default(0),
    sessionWarnings: text('session_warnings'),
    rawRetention: text('raw_retention'),
    inputTokens: integer('input_tokens').default(0),
    outputTokens: integer('output_tokens').default(0),
    cachedInputTokens: integer('cached_input_tokens').default(0),
    cacheCreationTokens: integer('cache_creation_tokens').default(0),
    cacheReadTokens: integer('cache_read_tokens').default(0),
    toolTokens: integer('tool_tokens').default(0),
    reasoningTokens: integer('reasoning_tokens').default(0),
    totalTokens: integer('total_tokens').default(0),
    tokenUsageEstimated: integer('token_usage_estimated', { mode: 'boolean' }).default(false),
    estimatedCost: real('estimated_cost').default(0),
    simulatedCost: real('simulated_cost').default(0),
    costEstimated: integer('cost_estimated', { mode: 'boolean' }).default(false),
    recordedCost: real('recorded_cost'),
    pricingSource: text('pricing_source'),
    model: text('model'),
    metadata: text('metadata'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    providerIdx: index('idx_sessions_provider').on(t.provider),
    modelIdx: index('idx_sessions_model').on(t.model),
    projectIdx: index('idx_sessions_project').on(t.projectName),
    updatedIdx: index('idx_sessions_updated').on(t.updatedAt),
    providerHashIdx: index('idx_sessions_provider_hash').on(t.provider, t.fileHash),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    timestamp: text('timestamp'),
    role: text('role').notNull(),
    model: text('model'),
    contentText: text('content_text'),
    contentPreview: text('content_preview').notNull(),
    contentHidden: integer('content_hidden', { mode: 'boolean' }).default(false),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    cacheCreationTokens: integer('cache_creation_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    toolTokens: integer('tool_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    usageConfidence: text('usage_confidence'),
    recordedCost: real('recorded_cost'),
    simulatedCost: real('simulated_cost'),
    costEstimated: integer('cost_estimated', { mode: 'boolean' }).default(false),
    messageMetadata: text('message_metadata'),
    toolName: text('tool_name'),
    toolInputPreview: text('tool_input_preview'),
    toolOutputPreview: text('tool_output_preview'),
    raw: text('raw'),
    estimatedCost: real('estimated_cost').default(0),
  },
  (t) => ({
    sessionIdx: index('idx_messages_session').on(t.sessionId),
    roleIdx: index('idx_messages_role').on(t.role),
    timestampIdx: index('idx_messages_timestamp').on(t.timestamp),
  }),
);

export const usageDaily = sqliteTable(
  'usage_daily',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    date: text('date').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    projectName: text('project_name'),
    sessions: integer('sessions').default(0),
    prompts: integer('prompts').default(0),
    inputTokens: integer('input_tokens').default(0),
    outputTokens: integer('output_tokens').default(0),
    cachedInputTokens: integer('cached_input_tokens').default(0),
    reasoningTokens: integer('reasoning_tokens').default(0),
    totalTokens: integer('total_tokens').default(0),
    estimatedCost: real('estimated_cost').default(0),
  },
  (t) => ({
    dateIdx: index('idx_usage_daily_date').on(t.date),
    providerIdx: index('idx_usage_daily_provider').on(t.provider),
    dateProviderIdx: index('idx_usage_daily_date_provider').on(t.date, t.provider),
  }),
);

export const usageMonthly = sqliteTable(
  'usage_monthly',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    month: text('month').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    projectName: text('project_name'),
    sessions: integer('sessions').default(0),
    prompts: integer('prompts').default(0),
    inputTokens: integer('input_tokens').default(0),
    outputTokens: integer('output_tokens').default(0),
    cachedInputTokens: integer('cached_input_tokens').default(0),
    reasoningTokens: integer('reasoning_tokens').default(0),
    totalTokens: integer('total_tokens').default(0),
    estimatedCost: real('estimated_cost').default(0),
  },
  (t) => ({
    monthIdx: index('idx_usage_monthly_month').on(t.month),
    providerIdx: index('idx_usage_monthly_provider').on(t.provider),
  }),
);

export const usageYearly = sqliteTable(
  'usage_yearly',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    year: text('year').notNull(),
    provider: text('provider').notNull(),
    model: text('model'),
    projectName: text('project_name'),
    sessions: integer('sessions').default(0),
    prompts: integer('prompts').default(0),
    inputTokens: integer('input_tokens').default(0),
    outputTokens: integer('output_tokens').default(0),
    cachedInputTokens: integer('cached_input_tokens').default(0),
    reasoningTokens: integer('reasoning_tokens').default(0),
    totalTokens: integer('total_tokens').default(0),
    estimatedCost: real('estimated_cost').default(0),
  },
  (t) => ({
    yearIdx: index('idx_usage_yearly_year').on(t.year),
    providerIdx: index('idx_usage_yearly_provider').on(t.provider),
  }),
);

export const pricingModels = sqliteTable('pricing_models', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  currency: text('currency').default('USD'),
  inputPerMillion: real('input_per_million').notNull(),
  outputPerMillion: real('output_per_million').notNull(),
  cachedInputPerMillion: real('cached_input_per_million'),
  cacheWritePerMillion: real('cache_write_per_million'),
  reasoningPerMillion: real('reasoning_per_million'),
  profile: text('profile').default('api-standard'),
  notes: text('notes'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const scanRuns = sqliteTable('scan_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  status: text('status').notNull(),
  provider: text('provider'),
  filesScanned: integer('files_scanned').default(0),
  sessionsFound: integer('sessions_found').default(0),
  messagesFound: integer('messages_found').default(0),
  warningsCount: integer('warnings_count').default(0),
  errors: text('errors'),
});

export const parserWarnings = sqliteTable(
  'parser_warnings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    scanRunId: integer('scan_run_id').references(() => scanRuns.id),
    file: text('file').notNull(),
    line: integer('line'),
    message: text('message').notNull(),
    severity: text('severity').notNull(),
    code: text('code'),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    scanRunIdx: index('idx_warnings_scan_run').on(t.scanRunId),
  }),
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Tracks last-seen hash/mtime for incremental scan skips. */
export const scannedFiles = sqliteTable('scanned_files', {
  path: text('path').primaryKey(),
  fileHash: text('file_hash').notNull(),
  mtimeMs: integer('mtime_ms').notNull(),
  lastScannedAt: text('last_scanned_at').notNull(),
});
