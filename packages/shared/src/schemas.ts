import { z } from 'zod';
import { listProviderIds } from './providers.js';
import type { Provider } from './types.js';

const providerIds = listProviderIds() as [Provider, ...Provider[]];

export const providerSchema = z.enum(providerIds);
export const pricingProviderSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'qwen',
  'moonshot',
  'other',
]);
export const privacyModeSchema = z.enum(['disabled', 'preview', 'full', 'raw']);
export const messageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool', 'unknown']);
export const pricingProfileSchema = z.enum([
  'api-standard',
  'api-batch',
  'subscription-equivalent',
  'custom',
]);
export const timeGranularitySchema = z.enum(['day', 'week', 'month', 'year']);

export const tokenTotalsSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cachedInputTokens: z.number().default(0),
  cacheCreationTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  toolTokens: z.number().default(0),
  reasoningTokens: z.number().default(0),
  totalTokens: z.number().default(0),
});

export const costTotalsSchema = z.object({
  recordedCost: z.number().optional(),
  simulatedCost: z.number().optional(),
  pricingSource: z.enum(['exact', 'contains', 'fallback', 'none']).optional(),
  currency: z.string().default('USD'),
  estimated: z.boolean().default(false),
});

export const normalizedMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.string().optional(),
  role: messageRoleSchema,
  model: z.string().optional(),
  contentText: z.string().optional(),
  contentPreview: z.string(),
  contentHidden: z.boolean().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  cacheCreationTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  toolTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  usageConfidence: z
    .enum([
      'exact',
      'cumulative-delta',
      'provider-recorded-cost',
      'estimated-from-text',
      'metadata-only',
      'unavailable',
    ])
    .optional(),
  recordedCost: z.number().optional(),
  simulatedCost: z.number().optional(),
  costEstimated: z.boolean().optional(),
  toolName: z.string().optional(),
  toolInputPreview: z.string().optional(),
  toolOutputPreview: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  raw: z.unknown().optional(),
});

export const normalizedSessionSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  sourcePath: z.string().optional(),
  storageKind: z
    .enum(['jsonl', 'json', 'sqlite', 'markdown', 'otel', 'mixed'])
    .optional(),
  supportLevel: z
    .enum([
      'exact-usage',
      'partial-usage',
      'prompt-history-only',
      'detected-only',
      'unsupported',
    ])
    .optional(),
  usageConfidence: z
    .enum([
      'exact',
      'cumulative-delta',
      'provider-recorded-cost',
      'estimated-from-text',
      'metadata-only',
      'unavailable',
    ])
    .optional(),
  projectPath: z.string().optional(),
  projectName: z.string().optional(),
  startedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  messageCount: z.number().optional(),
  promptCount: z.number().optional(),
  rawRetention: privacyModeSchema.optional(),
  messages: z.array(normalizedMessageSchema),
  totals: tokenTotalsSchema,
  costs: costTotalsSchema.optional(),
  tokenUsageEstimated: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const modelPricingSchema = z.object({
  provider: pricingProviderSchema,
  model: z.string(),
  currency: z.literal('USD'),
  inputPerMillion: z.number().min(0),
  outputPerMillion: z.number().min(0),
  cachedInputPerMillion: z.number().min(0).optional(),
  cacheWritePerMillion: z.number().min(0).optional(),
  reasoningPerMillion: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const modelAliasEntrySchema = z.union([
  z.string(),
  z.object({
    target: z.string(),
    provider: pricingProviderSchema.optional(),
  }),
]);

export const modelAliasMapSchema = z.record(z.string(), modelAliasEntrySchema);

export const providerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  paths: z.array(z.string()).default([]),
});

export const appConfigSchema = z.object({
  privacyMode: privacyModeSchema.default('disabled'),
  providers: z.record(providerSchema, providerConfigSchema).default({}),
  customPaths: z.array(z.string()).default([]),
  dbPath: z.string().optional(),
  currency: z.string().default('USD'),
  storeRawRecords: z.boolean().default(false),
  resimulateRecordedCosts: z.boolean().default(false),
  estimatePromptOnlySources: z.boolean().default(false),
  modelAliases: modelAliasMapSchema.optional(),
});

export type ParsedAppConfig = z.infer<typeof appConfigSchema>;

/** Validate and parse a config object; throws ZodError on invalid input. */
export function parseAppConfig(input: unknown): ParsedAppConfig {
  return appConfigSchema.parse(input);
}

/** Safe parse returning success/error without throwing. */
export function safeParseAppConfig(input: unknown) {
  return appConfigSchema.safeParse(input);
}
