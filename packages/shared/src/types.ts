export type Provider =
  | 'codex'
  | 'claude'
  | 'gemini'
  | 'opencode'
  | 'qwen'
  | 'goose'
  | 'droid'
  | 'amp'
  | 'codebuff'
  | 'kimi'
  | 'copilot'
  | 'openclaw'
  | 'hermes'
  | 'pi-agent'
  | 'kilo'
  | 'aider'
  | 'cursor'
  | 'specstory'
  | 'crush';

export type PricingProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'qwen'
  | 'moonshot'
  | 'other';
export type PrivacyMode = 'disabled' | 'preview' | 'full' | 'raw';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';
export type PricingProfile = 'api-standard' | 'api-batch' | 'subscription-equivalent' | 'custom';
export type TimeGranularity = 'day' | 'week' | 'month' | 'year';

import type {
  ProviderSupportLevel,
  ProviderStorageKind,
  UsageConfidence,
} from './providers.js';

export type { ProviderSupportLevel, ProviderStorageKind, UsageConfidence };

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  /** @deprecated Prefer cacheReadTokens + cacheCreationTokens; kept for backward compatibility. */
  cachedInputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  toolTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type PricingSource = 'exact' | 'contains' | 'fallback' | 'none';

export type CostTotals = {
  recordedCost?: number;
  simulatedCost?: number;
  pricingSource?: PricingSource;
  currency: string;
  estimated: boolean;
};

export type NormalizedMessage = {
  id: string;
  sessionId: string;
  timestamp?: string;
  role: MessageRole;
  model?: string;
  contentText?: string;
  contentPreview: string;
  contentHidden?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  toolTokens?: number;
  reasoningTokens?: number;
  usageConfidence?: UsageConfidence;
  recordedCost?: number;
  simulatedCost?: number;
  costEstimated?: boolean;
  toolName?: string;
  toolInputPreview?: string;
  toolOutputPreview?: string;
  metadata?: Record<string, unknown>;
  raw?: unknown;
};

export type NormalizedSession = {
  id: string;
  provider: Provider;
  sourcePath?: string;
  storageKind?: ProviderStorageKind;
  supportLevel?: ProviderSupportLevel;
  usageConfidence?: UsageConfidence;
  projectPath?: string;
  projectName?: string;
  startedAt?: string;
  updatedAt?: string;
  messageCount?: number;
  promptCount?: number;
  warnings?: ParserWarning[];
  rawRetention?: PrivacyMode;
  messages: NormalizedMessage[];
  totals: TokenTotals;
  costs?: CostTotals;
  /** True when token counts were partially or fully estimated rather than provider-reported. */
  tokenUsageEstimated?: boolean;
  metadata?: Record<string, unknown>;
};

export type ModelPricing = {
  provider: PricingProvider;
  model: string;
  currency: 'USD';
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  cacheWritePerMillion?: number;
  reasoningPerMillion?: number;
  notes?: string;
  profile?: PricingProfile;
};

/** Maps a session model name to a canonical pricing-table model id. */
export type ModelAliasEntry =
  | string
  | { target: string; provider?: PricingProvider };

export type ModelAliasMap = Record<string, ModelAliasEntry>;

/** A provider-specific session source discovered before parsing (Phase 2+). */
export type DiscoveredSource = {
  path: string;
  provider: Provider;
  storageKind?: ProviderStorageKind;
  label?: string;
};

export type ParserOptions = {
  privacyMode: PrivacyMode;
  maxFileSize?: number;
  /** Allow text-based token estimation for prompt-history-only providers. */
  estimatePromptOnlySources?: boolean;
  /** Persist provider-native raw records (debugging); default false. */
  storeRawRecords?: boolean;
};

/** Alias used in the implementation plan; identical to {@link ParserOptions}. */
export type ParseOptions = ParserOptions;

export type ProviderParser = {
  provider: Provider;
  canParse(filePath: string, sample: string): boolean;
  parse(filePath: string, options?: ParseOptions): Promise<ParseResult>;
  /**
   * Optional provider-native discovery. When absent, the global
   * `discoverSessionFiles` path globs are used instead.
   */
  discover?(config: AppConfig): Promise<DiscoveredSource[]>;
};

export type ParseResult = {
  sessions: NormalizedSession[];
  warnings: ParserWarning[];
};

export type ParserWarningCode =
  | 'missing-file'
  | 'unknown-schema'
  | 'missing-token-fields'
  | 'missing-model'
  | 'missing-timestamp'
  | 'sqlite-table-missing'
  | 'json-parse-error'
  | 'cost-unavailable'
  | 'prompt-storage-disabled'
  | 'detected-only'
  | 'unparsed-format'
  | 'sqlite-locked';

export type ParserWarning = {
  file: string;
  line?: number;
  message: string;
  severity: 'warning' | 'error';
  code?: ParserWarningCode;
};

export type ProviderConfig = { enabled: boolean; paths: string[] };

export type AppConfig = {
  privacyMode: PrivacyMode;
  /**
   * Per-provider overrides. The three first-class providers are always present;
   * any other registered provider may be added to opt in/out or override paths.
   */
  providers: Partial<Record<Provider, ProviderConfig>> & {
    claude: ProviderConfig;
    codex: ProviderConfig;
    gemini: ProviderConfig;
  };
  customPaths: string[];
  dbPath?: string;
  currency: string;
  storeRawRecords: boolean;
  /** Re-simulate provider-recorded costs from token counts instead of trusting them. */
  resimulateRecordedCosts?: boolean;
  /** Allow text-based token estimation for prompt-history-only providers. */
  estimatePromptOnlySources?: boolean;
  /** Optional overrides for bundled model alias resolution during pricing lookup. */
  modelAliases?: ModelAliasMap;
};

export type DailyUsage = {
  date: string;
  provider: Provider;
  model?: string;
  projectName?: string;
  sessions: number;
  prompts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

export type MonthlyUsage = {
  month: string;
  provider: Provider;
  model?: string;
  projectName?: string;
  sessions: number;
  prompts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

export type YearlyUsage = {
  year: string;
  provider: Provider;
  model?: string;
  projectName?: string;
  sessions: number;
  prompts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
};

export type StatsSummary = {
  totalSessions: number;
  totalPrompts: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalEstimatedCost: number;
  mostExpensiveModel: string;
  mostExpensiveDay: string;
  topProjects: Array<{ name: string; cost: number; sessions: number }>;
  /** Sessions whose display cost was simulated or pricing was estimated. */
  costEstimatedSessions: number;
  /** Sessions with partially or fully estimated token counts. */
  tokenEstimatedSessions: number;
  /** Session counts grouped by persisted support level. */
  sessionsBySupportLevel: Partial<Record<ProviderSupportLevel, number>>;
  /** Session counts grouped by persisted usage confidence. */
  sessionsByUsageConfidence: Partial<Record<UsageConfidence, number>>;
};

export type DashboardData = {
  summary: StatsSummary;
  costByProvider: Array<{ provider: Provider; cost: number }>;
  tokensByProvider: Array<{ provider: Provider; tokens: number }>;
  costByModel: Array<{ model: string; cost: number }>;
  recentSessions: NormalizedSession[];
  timeSeriesData: DailyUsage[];
};
