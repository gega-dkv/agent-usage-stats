import fs from 'fs';
import crypto from 'crypto';
import type {
  Provider,
  AppConfig,
  ParserWarning,
  NormalizedSession,
  NormalizedMessage,
  PricingSource,
  PrivacyMode,
} from '@agent-usage/shared';
import {
  providerToPricingProvider,
  listProviders,
  safeParseAppConfig,
  PROVIDER_REGISTRY,
  normalizeTokenTotals,
  totalsFromMessages,
} from '@agent-usage/shared';
import type { ModelPricing, PricingProfile, PricingProvider } from '@agent-usage/shared';
import { discoverSessionFiles, getParserForFile, sanitizeMessageForPrivacy } from '@agent-usage/parsers';
import type { AppDatabase } from '@agent-usage/db';
import {
  getPricingModels,
  getSetting,
  insertParserWarning,
  insertScanRun,
  isFileUnchanged,
  markFileScanned,
  refreshUsageRollups,
  updateScanRunProgress,
  updateSessionCosts,
  upsertMessages,
  upsertPricingModel,
  upsertSession,
} from '@agent-usage/db';
import { calculateCost, lookupPricing, getDefaultPricingModels } from '@agent-usage/pricing';

export type ScanResult = {
  filesScanned: number;
  filesSkipped: number;
  sessionsFound: number;
  messagesFound: number;
  warnings: ParserWarning[];
  errors: string[];
};

export async function scanSessions(
  database: AppDatabase,
  config: AppConfig,
  options?: {
    provider?: Provider;
    paths?: string[];
    /** When true, bypass incremental file cache and re-parse every file. */
    force?: boolean;
  },
): Promise<ScanResult> {
  const { db, sqlite } = database;
  const result: ScanResult = {
    filesScanned: 0,
    filesSkipped: 0,
    sessionsFound: 0,
    messagesFound: 0,
    warnings: [],
    errors: [],
  };

  const persistedPrivacy = getSetting(db, 'privacyMode') as PrivacyMode | undefined;
  const privacyMode: PrivacyMode = persistedPrivacy ?? config.privacyMode;

  const scanRunId = insertScanRun(db, { status: 'running', provider: options?.provider }) as number;

  try {
    const files = await discoverSessionFiles(config, options?.paths);
    const filteredFiles = options?.provider
      ? files.filter((f: { provider: Provider }) => f.provider === options.provider)
      : files;

    result.filesScanned = filteredFiles.length;

    const pricingModels = ensurePricingModels(db);

    for (const file of filteredFiles) {
      try {
        const stat = fs.statSync(file.path);
        const content = fs.readFileSync(file.path, 'utf-8');
        const sample = content.slice(0, 4096);
        const fileHash = crypto.createHash('sha256').update(content).digest('hex');
        const mtimeMs = stat.mtimeMs;

        if (!options?.force && isFileUnchanged(sqlite, file.path, fileHash, mtimeMs)) {
          result.filesSkipped++;
          continue;
        }

        const parser = getParserForFile(file.path, sample);

        if (!parser) {
          result.warnings.push({
            file: file.path,
            message: 'No parser found for this file format',
            severity: 'warning',
            code: 'unparsed-format',
          });
          continue;
        }

        const parseResult = await parser.parse(file.path, {
          privacyMode,
          estimatePromptOnlySources: config.estimatePromptOnlySources,
          storeRawRecords: config.storeRawRecords,
        });

        for (const rawSession of parseResult.sessions) {
          const session = enrichSession(rawSession, file.path, privacyMode, config.storeRawRecords);
          const sessionId = upsertSession(db, session, fileHash) as string;

          const sessionModel = pickSessionModel(session);
          const costResult = resolveSessionCost(session, pricingModels, config);
          updateSessionCosts(db, sessionId, {
            estimatedCost: costResult.displayCost,
            simulatedCost: costResult.simulatedCost,
            model: sessionModel || 'unknown',
            costEstimated: costResult.estimated,
            recordedCost: costResult.recordedCost,
            pricingSource: costResult.pricingSource,
          });

          upsertMessages(db, sessionId, session.messages);

          result.sessionsFound++;
          result.messagesFound += session.messages.length;
        }

        for (const warning of parseResult.warnings) {
          result.warnings.push(warning);
          insertParserWarning(db, scanRunId, warning);
        }

        markFileScanned(sqlite, file.path, fileHash, mtimeMs);
        updateScanRunProgress(db, scanRunId, {
          filesScanned: result.filesScanned - result.filesSkipped,
          sessionsFound: result.sessionsFound,
          messagesFound: result.messagesFound,
        });
      } catch (e) {
        result.errors.push(`Error processing ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    sqlite
      .prepare(
        'UPDATE scan_runs SET completed_at = ?, status = ?, files_scanned = ?, sessions_found = ?, messages_found = ?, warnings_count = ? WHERE id = ?',
      )
      .run(
        new Date().toISOString(),
        'completed',
        result.filesScanned,
        result.sessionsFound,
        result.messagesFound,
        result.warnings.length,
        scanRunId,
      );

    refreshUsageRollups(sqlite);
  } catch (e) {
    result.errors.push(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    sqlite
      .prepare('UPDATE scan_runs SET completed_at = ?, status = ?, errors = ? WHERE id = ?')
      .run(
        new Date().toISOString(),
        'failed',
        JSON.stringify(result.errors),
        scanRunId,
      );
  }

  return result;
}

/** Apply registry defaults and derived counts to a parsed session. */
export function enrichSession(
  session: NormalizedSession,
  sourcePath: string,
  privacyMode: PrivacyMode,
  storeRawRecords = false,
): NormalizedSession {
  const def = PROVIDER_REGISTRY[session.provider];
  const totals = normalizeTokenTotals(session.totals);
  const messageCount = session.messageCount ?? session.messages.length;
  const promptCount =
    session.promptCount ?? session.messages.filter((m) => m.role === 'user').length;

  const tokenUsageEstimated =
    session.tokenUsageEstimated ??
    session.messages.some(
      (m) =>
        m.usageConfidence === 'estimated-from-text' ||
        (m.inputTokens != null && m.usageConfidence === undefined && def?.defaultConfidence === 'estimated-from-text'),
    );

  return {
    ...session,
    sourcePath: session.sourcePath ?? sourcePath,
    storageKind: session.storageKind ?? def?.storageKinds[0],
    supportLevel: session.supportLevel ?? def?.supportLevel,
    usageConfidence: session.usageConfidence ?? def?.defaultConfidence,
    messageCount,
    promptCount,
    rawRetention: session.rawRetention ?? privacyMode,
    totals,
    tokenUsageEstimated,
    messages: session.messages.map((msg) => {
      const sanitized = sanitizeMessageForPrivacy(msg, privacyMode, storeRawRecords);
      return {
        ...sanitized,
        usageConfidence: msg.usageConfidence ?? session.usageConfidence ?? def?.defaultConfidence,
        contentHidden:
          sanitized.contentHidden ??
          (privacyMode === 'disabled' && !sanitized.contentText),
      };
    }),
  };
}

function resolveSessionCost(
  session: NormalizedSession,
  pricingModels: ModelPricing[],
  config: AppConfig,
): {
  displayCost: number;
  simulatedCost: number;
  recordedCost?: number;
  estimated: boolean;
  pricingSource: PricingSource;
} {
  const recordedCost = session.costs?.recordedCost ?? session.metadata?.recordedCost as number | undefined;

  // A session usually spans several models (e.g. Opus + Sonnet + Haiku), so we
  // price each model's tokens with its own rates and sum, rather than charging
  // the whole session at a single model's rates.
  const provider = providerToPricingProvider(session.provider);
  let simulatedCost = 0;
  let anyPriced = false;
  let anyEstimated = false;
  let anyFallback = false;

  for (const [model, messages] of groupMessagesByModel(session.messages)) {
    const groupTotals = totalsFromMessages(messages);
    if (groupTotals.totalTokens === 0) continue;

    const lookup = lookupPricing(
      model || undefined,
      provider,
      pricingModels,
      'api-standard',
      config.modelAliases,
    );

    if (lookup.pricing) {
      const { cost, isEstimated } = calculateCost(groupTotals, lookup.pricing);
      simulatedCost += cost;
      anyPriced = true;
      if (isEstimated || lookup.isEstimated) anyEstimated = true;
      if (lookup.isEstimated) anyFallback = true;
    } else {
      anyEstimated = true;
    }
  }

  const pricingSource: PricingSource = !anyPriced ? 'none' : anyFallback ? 'fallback' : 'exact';
  const costEstimated = anyEstimated || !anyPriced;

  session.costs = {
    recordedCost,
    simulatedCost,
    pricingSource,
    currency: config.currency,
    estimated: costEstimated,
  };

  const useSimulated = config.resimulateRecordedCosts || recordedCost == null;
  const displayCost = useSimulated ? simulatedCost : recordedCost;

  return {
    displayCost,
    simulatedCost,
    recordedCost,
    estimated: useSimulated ? costEstimated : false,
    pricingSource,
  };
}

/** Group a session's messages by model id (empty string for model-less rows). */
function groupMessagesByModel(messages: NormalizedMessage[]): Map<string, NormalizedMessage[]> {
  const byModel = new Map<string, NormalizedMessage[]>();
  for (const message of messages) {
    const key = message.model ?? '';
    const list = byModel.get(key);
    if (list) list.push(message);
    else byModel.set(key, [message]);
  }
  return byModel;
}

/** Tokens attributable to a single message, used to weight the session model. */
function messageTokenWeight(message: NormalizedMessage): number {
  return (
    (message.inputTokens || 0) +
    (message.outputTokens || 0) +
    (message.cacheCreationTokens || 0) +
    (message.cacheReadTokens || message.cachedInputTokens || 0)
  );
}

function ensurePricingModels(db: AppDatabase['db']): ModelPricing[] {
  const storedModels = getPricingModels(db);
  if (storedModels.length > 0) {
    return normalizeStoredPricing(storedModels);
  }

  const defaults = getDefaultPricingModels();
  for (const model of defaults) {
    upsertPricingModel(db, {
      provider: model.provider,
      model: model.model,
      inputPerMillion: model.inputPerMillion,
      outputPerMillion: model.outputPerMillion,
      cachedInputPerMillion: model.cachedInputPerMillion,
      cacheWritePerMillion: model.cacheWritePerMillion,
      reasoningPerMillion: model.reasoningPerMillion,
      profile: model.profile,
      notes: model.notes,
      isDefault: true,
    });
  }
  return normalizeStoredPricing(getPricingModels(db));
}

/**
 * The model shown for a session: the one that did the most work (most tokens),
 * not merely the first one seen. Sessions commonly span several models, so the
 * first message's model is often a small router/title call rather than the one
 * the user actually worked with.
 */
function pickSessionModel(session: NormalizedSession): string | undefined {
  const byModel = new Map<string, number>();
  for (const message of session.messages) {
    if (!message.model) continue;
    byModel.set(message.model, (byModel.get(message.model) ?? 0) + messageTokenWeight(message));
  }

  let best: string | undefined;
  let bestTokens = -1;
  for (const [model, tokens] of byModel) {
    if (tokens > bestTokens) {
      bestTokens = tokens;
      best = model;
    }
  }

  // No model carried tokens — fall back to the first model seen at all.
  if (best === undefined) {
    for (const message of session.messages) {
      if (message.model) return message.model;
    }
  }
  return best;
}

function normalizeStoredPricing(models: ReturnType<typeof getPricingModels>): ModelPricing[] {
  return models.map((model: ReturnType<typeof getPricingModels>[number]) => ({
    provider: model.provider as PricingProvider,
    model: model.model,
    currency: 'USD',
    inputPerMillion: model.inputPerMillion,
    outputPerMillion: model.outputPerMillion,
    cachedInputPerMillion: model.cachedInputPerMillion ?? undefined,
    cacheWritePerMillion: model.cacheWritePerMillion ?? undefined,
    reasoningPerMillion: model.reasoningPerMillion ?? undefined,
    profile: (model.profile ?? undefined) as PricingProfile | undefined,
    notes: model.notes ?? undefined,
  }));
}

export function getDefaultConfig(): AppConfig {
  const providers = {} as AppConfig['providers'];
  for (const def of listProviders()) {
    providers[def.id] = {
      enabled: def.enabledByDefault,
      paths: [],
    };
  }
  return {
    privacyMode: 'disabled',
    providers,
    customPaths: [],
    currency: 'USD',
    storeRawRecords: false,
    resimulateRecordedCosts: false,
    estimatePromptOnlySources: false,
  };
}

export type ConfigValidation = {
  ok: boolean;
  path?: string;
  errors?: string[];
};

function findConfigPath(configPath?: string): string | undefined {
  if (configPath) {
    return fs.existsSync(configPath) ? configPath : undefined;
  }

  const possiblePaths = [
    'agent-usage.config.json',
    '.agent-usage.config.json',
    'agent-usage.config.jsonc',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/** Validate the on-disk config file without loading it into the app. */
export function validateConfig(configPath?: string): ConfigValidation {
  const resolved = findConfigPath(configPath);
  if (!resolved) {
    return { ok: true };
  }

  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    const raw = JSON.parse(content);
    const parsed = safeParseAppConfig(raw);
    if (parsed.success) {
      return { ok: true, path: resolved };
    }
    return {
      ok: false,
      path: resolved,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  } catch (e) {
    return {
      ok: false,
      path: resolved,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}

function warnInvalidConfig(path: string, errors: string[]): void {
  const detail = errors.map((e) => `  - ${e}`).join('\n');
  console.warn(
    `Warning: invalid config at ${path}; using defaults.\n${detail}`,
  );
}

export function loadConfig(configPath?: string): AppConfig {
  const defaultConfig = getDefaultConfig();
  const resolved = findConfigPath(configPath);

  if (resolved) {
    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      const raw = JSON.parse(content);
      const parsed = safeParseAppConfig(raw);
      if (parsed.success) {
        const config = parsed.data;
        return {
          ...defaultConfig,
          ...config,
          providers: { ...defaultConfig.providers, ...config.providers },
        };
      }
      warnInvalidConfig(
        resolved,
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      );
    } catch (e) {
      warnInvalidConfig(resolved, [e instanceof Error ? e.message : String(e)]);
    }
  }

  return defaultConfig;
}

/** Persist config to agent-usage.config.json in cwd (creates file if missing). */
export function saveConfig(config: AppConfig, configPath?: string): string {
  const target = findConfigPath(configPath) ?? 'agent-usage.config.json';
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  return target;
}
