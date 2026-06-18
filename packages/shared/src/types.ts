export type Provider = 'codex' | 'claude' | 'gemini';
export type PricingProvider = 'openai' | 'anthropic' | 'google';
export type PrivacyMode = 'disabled' | 'preview' | 'full' | 'raw';
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'unknown';
export type PricingProfile = 'api-standard' | 'api-batch' | 'subscription-equivalent' | 'custom';
export type TimeGranularity = 'day' | 'week' | 'month' | 'year';

export type TokenTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type NormalizedMessage = {
  id: string;
  sessionId: string;
  timestamp?: string;
  role: MessageRole;
  model?: string;
  contentText?: string;
  contentPreview: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  toolName?: string;
  toolInputPreview?: string;
  toolOutputPreview?: string;
  raw?: unknown;
};

export type NormalizedSession = {
  id: string;
  provider: Provider;
  projectPath?: string;
  projectName?: string;
  startedAt?: string;
  updatedAt?: string;
  messages: NormalizedMessage[];
  totals: TokenTotals;
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

export type ProviderParser = {
  provider: Provider;
  canParse(filePath: string, sample: string): boolean;
  parse(filePath: string, options?: ParserOptions): Promise<ParseResult>;
};

export type ParserOptions = {
  privacyMode: PrivacyMode;
  maxFileSize?: number;
};

export type ParseResult = {
  sessions: NormalizedSession[];
  warnings: ParserWarning[];
};

export type ParserWarning = {
  file: string;
  line?: number;
  message: string;
  severity: 'warning' | 'error';
};

export type AppConfig = {
  privacyMode: PrivacyMode;
  providers: {
    claude: { enabled: boolean; paths: string[] };
    codex: { enabled: boolean; paths: string[] };
    gemini: { enabled: boolean; paths: string[] };
  };
  customPaths: string[];
  dbPath?: string;
  currency: string;
  storeRawRecords: boolean;
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
};

export type DashboardData = {
  summary: StatsSummary;
  costByProvider: Array<{ provider: Provider; cost: number }>;
  tokensByProvider: Array<{ provider: Provider; tokens: number }>;
  costByModel: Array<{ model: string; cost: number }>;
  recentSessions: NormalizedSession[];
  timeSeriesData: DailyUsage[];
};
