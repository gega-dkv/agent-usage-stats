import fs from 'fs';
import crypto from 'crypto';
import type { Provider, AppConfig, ParserWarning, NormalizedSession } from '@agent-usage/shared';
import { providerToPricingProvider } from '@agent-usage/shared';
import type { ModelPricing, PricingProfile, PricingProvider } from '@agent-usage/shared';
import { discoverSessionFiles, getParserForFile } from '@agent-usage/parsers';
import type { AppDatabase } from '@agent-usage/db';
import {
  getPricingModels,
  getSetting,
  insertParserWarning,
  insertScanRun,
  refreshUsageRollups,
  upsertMessages,
  upsertPricingModel,
  upsertSession,
} from '@agent-usage/db';
import { calculateCost, lookupPricing, getDefaultPricingModels } from '@agent-usage/pricing';
import type { PrivacyMode } from '@agent-usage/shared';

export type ScanResult = {
  filesScanned: number;
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
  },
): Promise<ScanResult> {
  const { db, sqlite } = database;
  const result: ScanResult = {
    filesScanned: 0,
    sessionsFound: 0,
    messagesFound: 0,
    warnings: [],
    errors: [],
  };

  // A privacy mode persisted via the CLI/web (`settings` table) overrides the
  // config-file default, so `privacy set` reliably affects subsequent scans.
  const persistedPrivacy = getSetting(db, 'privacyMode') as PrivacyMode | undefined;
  const privacyMode: PrivacyMode = persistedPrivacy ?? config.privacyMode;

  // Create scan run record
  const scanRunId = insertScanRun(db, { status: 'running', provider: options?.provider }) as number;

  try {
    // Discover files
    const files = await discoverSessionFiles(config, options?.paths);
    const filteredFiles = options?.provider
      ? files.filter((f: { provider: Provider }) => f.provider === options.provider)
      : files;

    result.filesScanned = filteredFiles.length;

    const pricingModels = ensurePricingModels(db);

    for (const file of filteredFiles) {
      try {
        // Read the full file once: a streaming hash for dedup, a sample for
        // parser detection. Hashing the entire content (not just the first 4 KB)
        // means appended sessions are correctly re-ingested.
        const content = fs.readFileSync(file.path, 'utf-8');
        const sample = content.slice(0, 4096);
        const fileHash = crypto.createHash('sha256').update(content).digest('hex');
        const parser = getParserForFile(file.path, sample);

        if (!parser) {
          result.warnings.push({
            file: file.path,
            message: 'No parser found for this file format',
            severity: 'warning',
          });
          continue;
        }

        // Parse the file
        const parseResult = await parser.parse(file.path, {
          privacyMode,
        });

        // Store sessions
        for (const session of parseResult.sessions) {
          const sessionId = upsertSession(db, session, fileHash) as string;

          // Calculate cost
          const sessionModel = pickSessionModel(session);
          const pricing = lookupPricing(
            sessionModel,
            providerToPricingProvider(session.provider),
            pricingModels,
          );

          if (pricing.pricing) {
            const { cost, isEstimated } = calculateCost(session.totals, pricing.pricing);
            const costEstimated = isEstimated || pricing.isEstimated;
            sqlite
              .prepare(
                'UPDATE sessions SET estimated_cost = ?, model = ?, cost_estimated = ? WHERE id = ?',
              )
              .run(cost, sessionModel || 'unknown', costEstimated ? 1 : 0, sessionId);
          } else {
            // No pricing available at all — keep cost at 0 but mark estimated.
            sqlite
              .prepare('UPDATE sessions SET cost_estimated = 1, model = ? WHERE id = ?')
              .run(sessionModel || 'unknown', sessionId);
          }

          // Store messages
          upsertMessages(db, sessionId, session.messages);

          result.sessionsFound++;
          result.messagesFound += session.messages.length;
        }

        // Store warnings
        for (const warning of parseResult.warnings) {
          result.warnings.push(warning);
          insertParserWarning(db, scanRunId, warning);
        }
      } catch (e) {
        result.errors.push(`Error processing ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Update scan run
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

/** Pick the most representative model for a session (first message that names one). */
function pickSessionModel(session: NormalizedSession): string | undefined {
  for (const message of session.messages) {
    if (message.model) return message.model;
  }
  return undefined;
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
  return {
    privacyMode: 'disabled',
    providers: {
      claude: { enabled: true, paths: [] },
      codex: { enabled: true, paths: [] },
      gemini: { enabled: true, paths: [] },
    },
    customPaths: [],
    currency: 'USD',
    storeRawRecords: false,
  };
}

export function loadConfig(configPath?: string): AppConfig {
  const defaultConfig = getDefaultConfig();

  if (!configPath) {
    // Try to load from current directory
    const possiblePaths = [
      'agent-usage.config.json',
      '.agent-usage.config.json',
      'agent-usage.config.jsonc',
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
    }
  }

  if (configPath && fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      return { ...defaultConfig, ...config };
    } catch {
      // Return default config on parse error
    }
  }

  return defaultConfig;
}
