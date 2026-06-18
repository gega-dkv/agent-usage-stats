import { z } from 'zod';

export const providerSchema = z.enum(['codex', 'claude', 'gemini']);
export const pricingProviderSchema = z.enum(['openai', 'anthropic', 'google']);
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
  reasoningTokens: z.number().default(0),
  totalTokens: z.number().default(0),
});

export const normalizedMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.string().optional(),
  role: messageRoleSchema,
  model: z.string().optional(),
  contentText: z.string().optional(),
  contentPreview: z.string(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  reasoningTokens: z.number().optional(),
  toolName: z.string().optional(),
  toolInputPreview: z.string().optional(),
  toolOutputPreview: z.string().optional(),
  raw: z.unknown().optional(),
});

export const normalizedSessionSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  projectPath: z.string().optional(),
  projectName: z.string().optional(),
  startedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  messages: z.array(normalizedMessageSchema),
  totals: tokenTotalsSchema,
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

export const appConfigSchema = z.object({
  privacyMode: privacyModeSchema.default('disabled'),
  providers: z.object({
    claude: z.object({
      enabled: z.boolean().default(true),
      paths: z.array(z.string()).default([]),
    }),
    codex: z.object({
      enabled: z.boolean().default(true),
      paths: z.array(z.string()).default([]),
    }),
    gemini: z.object({
      enabled: z.boolean().default(true),
      paths: z.array(z.string()).default([]),
    }),
  }),
  customPaths: z.array(z.string()).default([]),
  dbPath: z.string().optional(),
  currency: z.string().default('USD'),
  storeRawRecords: z.boolean().default(false),
});
