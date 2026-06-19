#!/usr/bin/env node

import { Command } from 'commander';
import { initializeDatabase, getSchemaVersion } from '@agent-usage/db';
import {
  getDailyUsage,
  getWeeklyUsage,
  getMonthlyUsage,
  getYearlyUsage,
  getStatsSummary,
  searchMessages,
  getPricingModels,
  upsertPricingModel,
  getSetting,
  setSetting,
  purgeContent,
  refreshUsageRollups,
  getScanRuns,
  getParserWarnings,
  getSessions,
} from '@agent-usage/db';
import { scanSessions, loadConfig, validateConfig } from '@agent-usage/core';
import {
  detectAgentInstallations,
  getProviderDefaultPaths,
  expandPath,
} from '@agent-usage/parsers';
import type { AgentInstallation } from '@agent-usage/parsers';
import { getDefaultPricingModels } from '@agent-usage/pricing';
import {
  formatNumber,
  formatCurrency,
  getProviderDefinition,
  isKnownProvider,
  providersWithParser,
} from '@agent-usage/shared';
import type { Provider } from '@agent-usage/shared';
import fs from 'fs';
import readline from 'readline/promises';
import path from 'path';
import { resolveWebAppTarget } from './web-app.js';

const program = new Command();

type StatsGranularity = 'day' | 'week' | 'month' | 'year';

function resolveStatsGranularity(options: {
  day?: boolean;
  week?: boolean;
  month?: boolean;
  year?: boolean;
  granularity?: string;
}): StatsGranularity | null {
  if (options.granularity) {
    const g = options.granularity.toLowerCase();
    if (g === 'day' || g === 'week' || g === 'month' || g === 'year') return g;
    throw new Error(`Invalid granularity "${options.granularity}". Use: day, week, month, year.`);
  }
  if (options.day) return 'day';
  if (options.week) return 'week';
  if (options.month) return 'month';
  if (options.year) return 'year';
  return null;
}

function getUsageByGranularity(
  db: ReturnType<typeof initializeDatabase>['db'],
  granularity: StatsGranularity,
  range: { from?: string; to?: string },
) {
  switch (granularity) {
    case 'day':
      return getDailyUsage(db, range);
    case 'week':
      return getWeeklyUsage(db, range);
    case 'month':
      return getMonthlyUsage(db, range);
    case 'year':
      return getYearlyUsage(db, range);
  }
}

function usageRowLabel(row: Record<string, unknown>): string {
  return String(row.date ?? row.week ?? row.month ?? row.year ?? 'N/A');
}

function wantsJson(options: { json?: boolean }, command?: Command): boolean {
  if (options.json) return true;
  try {
    return Boolean(command?.optsWithGlobals?.()?.json);
  } catch {
    return false;
  }
}

program
  .name('agent-usage')
  .description('Local-first AI session usage analyzer')
  .version('0.1.0');

// Scan command
const scanCmd = program
  .command('scan')
  .description('Scan session files from supported AI tools');

scanCmd
  .command('history')
  .description('Show recent scan runs')
  .option('-n, --limit <number>', 'Number of runs to show', '20')
  .option('--json', 'Output as JSON')
  .action((options: { limit: string; json?: boolean }, command) => {
    const json = wantsJson(options, command);
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);
    const runs = getScanRuns(db, parseInt(options.limit, 10));

    if (json) {
      console.log(JSON.stringify({ runs }, null, 2));
      return;
    }

    if (runs.length === 0) {
      console.log('No scan runs recorded yet.');
      return;
    }

    console.log('\nRecent scan runs:\n');
    for (const run of runs) {
      console.log(
        `#${run.id}  ${run.status}  files=${run.filesScanned}  sessions=${run.sessionsFound}  warnings=${run.warningsCount}  ${run.startedAt}`,
      );
    }
  });

scanCmd
  .option('-p, --provider <provider>', 'Filter by provider (claude, codex, gemini)')
  .option('--path <paths...>', 'Custom paths to scan')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = loadConfig();
    const database = initializeDatabase(config.dbPath);

    if (!options.json) {
      console.log('Scanning session files...\n');
    }

    const result = await scanSessions(database, config, {
      provider: options.provider as Provider | undefined,
      paths: options.path,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Files scanned: ${result.filesScanned}`);
    console.log(`Sessions found: ${result.sessionsFound}`);
    console.log(`Messages found: ${result.messagesFound}`);

    if (result.warnings.length > 0) {
      console.log(`\nWarnings (${result.warnings.length}):`);
      for (const w of result.warnings.slice(0, 10)) {
        console.log(`  - [${w.severity}] ${w.file}: ${w.message}`);
      }
      if (result.warnings.length > 10) {
        console.log(`  ... and ${result.warnings.length - 10} more`);
      }
    }

    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      for (const e of result.errors) {
        console.log(`  - ${e}`);
      }
    }

    console.log('\nScan complete!');
  });

program
  .command('sync')
  .description('Detect installed AI CLIs and sync their session files to the app')
  .option('-a, --agent <agent>', 'Agent to sync (all, codex, claude, gemini)')
  .option('-p, --provider <provider>', 'Alias for --agent')
  .option('--path <paths...>', 'Custom paths to sync')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = loadConfig();
    const database = initializeDatabase(config.dbPath);
    const agents = detectAgentInstallations(config).filter((agent) => agent.hasParser);
    const installed = agents.filter((agent) => agent.installed);
    const requestedAgent = parseSyncAgent(options.agent || options.provider);

    if (requestedAgent == null && installed.length === 0 && !options.path) {
      if (options.json) {
        console.log(JSON.stringify({ agents, error: 'No supported AI agent directories found' }, null, 2));
        return;
      }
      console.log('\nNo supported AI agent directories found.\n');
      for (const agent of agents) {
        console.log(`  ${agent.label}: ${agent.path}`);
      }
      console.log('\nInstall Codex, Claude, or Gemini CLI first, or pass --path.');
      return;
    }

    const choice = requestedAgent || await chooseSyncAgent(installed, Boolean(options.path), Boolean(options.json));
    const selectedProviders = getSelectedProviders(choice, installed, Boolean(options.path));

    if (selectedProviders.length === 0) {
      console.error(`No installed agent matched "${choice}".`);
      return;
    }

    if (options.json) {
      const result = await syncProviders(database, config, selectedProviders, options.path);
      console.log(JSON.stringify({ agents, selectedProviders, ...result }, null, 2));
      return;
    }

    console.log('\nDetected AI agents:\n');
    for (const agent of agents) {
      const mark = agent.installed ? 'found' : 'missing';
      console.log(`  ${agent.label.padEnd(8)} ${mark.padEnd(7)} ${agent.path}`);
    }

    const spinner = createSpinner(`Syncing ${formatProviderList(selectedProviders)} sessions`);
    try {
      const result = await syncProviders(database, config, selectedProviders, options.path);
      spinner.stop('done');
      console.log(`\nSynced to ${database.path}`);
      console.log(`Files scanned: ${result.filesScanned}`);
      console.log(`Sessions found: ${result.sessionsFound}`);
      console.log(`Messages found: ${result.messagesFound}`);

      if (result.warnings.length > 0) {
        console.log(`Warnings: ${result.warnings.length}`);
      }
      if (result.errors.length > 0) {
        console.log('\nErrors:');
        for (const error of result.errors) console.log(`  - ${error}`);
      }
    } catch (error) {
      spinner.stop('failed');
      console.error(error instanceof Error ? error.message : String(error));
    }
  });

// Stats command
const statsCmd = program
  .command('stats')
  .description('Show usage statistics');

statsCmd
  .command('export')
  .description('Export usage rollups as CSV or JSON')
  .option('-f, --format <format>', 'Output format: csv or json', 'json')
  .option('-d, --day', 'Export daily rollups')
  .option('-w, --week', 'Export weekly rollups')
  .option('-m, --month', 'Export monthly rollups')
  .option('-y, --year', 'Export yearly rollups')
  .option('-g, --granularity <granularity>', 'Granularity: day, week, month, year')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-o, --output <file>', 'Write to file instead of stdout')
  .option('--json', 'Emit export metadata as JSON')
  .action((options: {
    format: string;
    day?: boolean;
    week?: boolean;
    month?: boolean;
    year?: boolean;
    granularity?: string;
    from?: string;
    to?: string;
    output?: string;
    json?: boolean;
  }, command) => {
    const json = wantsJson(options, command);
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);
    let granularity: StatsGranularity;
    try {
      granularity = resolveStatsGranularity(options) ?? 'day';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
        return;
      }
      console.error(message);
      return;
    }
    const data = getUsageByGranularity(db, granularity, { from: options.from, to: options.to });

    const format = options.format === 'csv' ? 'csv' : 'json';
    const payload =
      format === 'csv' ? usageRowsToCsv(data as Array<Record<string, unknown>>) : JSON.stringify(data, null, 2);

    if (options.output) {
      fs.writeFileSync(options.output, payload);
      if (json) {
        console.log(
          JSON.stringify(
            { exported: data.length, format, granularity, path: options.output },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`Exported ${data.length} rows to ${options.output}`);
      return;
    }

    if (json && format === 'json') {
      console.log(payload);
      return;
    }
    if (json) {
      console.log(JSON.stringify({ exported: data.length, format, granularity, data }, null, 2));
      return;
    }
    console.log(payload);
  });

statsCmd
  .option('-d, --day', 'Show daily stats')
  .option('-w, --week', 'Show weekly stats')
  .option('-m, --month', 'Show monthly stats')
  .option('-y, --year', 'Show yearly stats')
  .option('-g, --granularity <granularity>', 'Granularity: day, week, month, year')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--json', 'Output as JSON')
  .action((options: {
    day?: boolean;
    week?: boolean;
    month?: boolean;
    year?: boolean;
    granularity?: string;
    from?: string;
    to?: string;
    json?: boolean;
  }) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    let granularity: StatsGranularity | null;
    try {
      granularity = resolveStatsGranularity(options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
        return;
      }
      console.error(message);
      return;
    }

    if (granularity) {
      const data = getUsageByGranularity(db, granularity, { from: options.from, to: options.to });

      if (options.json) {
        console.log(JSON.stringify({ granularity, data }, null, 2));
        return;
      }

      const periodLabel = granularity === 'week' ? 'Week' : granularity === 'month' ? 'Month' : granularity === 'year' ? 'Year' : 'Date';
      console.log('\nUsage Statistics:\n');
      console.log(
        periodLabel.padEnd(15) + 'Provider'.padEnd(12) + 'Sessions'.padEnd(10) + 'Tokens'.padEnd(12) + 'Cost',
      );
      console.log('-'.repeat(65));

      for (const row of data) {
        const r = row as Record<string, unknown>;
        console.log(
          usageRowLabel(r).padEnd(15) +
          String(r.provider).padEnd(12) +
          String(r.sessions).padEnd(10) +
          formatNumber(Number(r.totalTokens) || 0).padEnd(12) +
          formatCurrency(Number(r.estimatedCost) || 0),
        );
      }
      return;
    }

    // Show summary
    const summary = getStatsSummary(db, { from: options.from, to: options.to });

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log('\nUsage Summary:\n');
    console.log(`Sessions:          ${summary.totalSessions}`);
    console.log(`Prompts:           ${summary.totalPrompts}`);
    console.log(`Input tokens:      ${formatNumber(summary.totalInputTokens)}`);
    console.log(`Output tokens:     ${formatNumber(summary.totalOutputTokens)}`);
    console.log(`Cached tokens:     ${formatNumber(summary.totalCachedTokens)}`);
    console.log(`Reasoning tokens:  ${formatNumber(summary.totalReasoningTokens)}`);
    console.log(`Total tokens:      ${formatNumber(summary.totalTokens)}`);
    console.log(`Estimated cost:    ${formatCurrency(summary.totalEstimatedCost)}`);
    console.log(`Most expensive model: ${summary.mostExpensiveModel}`);
    console.log(`Most expensive day:   ${summary.mostExpensiveDay}`);

    if (summary.topProjects.length > 0) {
      console.log('\nTop Projects:');
      for (const p of summary.topProjects.slice(0, 5)) {
        console.log(`  ${p.name}: ${formatCurrency(p.cost)} (${p.sessions} sessions)`);
      }
    }
  });

// Prompts command
program
  .command('prompts')
  .description('Search and list prompts')
  .option('-s, --search <query>', 'Search prompt text')
  .option('-p, --provider <provider>', 'Filter by provider')
  .option('-l, --limit <number>', 'Limit results', '50')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    if (!options.search) {
      console.log('Please provide a search query with --search');
      return;
    }

    const results = searchMessages(db, options.search, {
      provider: options.provider as Provider | undefined,
      limit: parseInt(options.limit),
    });

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log(`\nPrompts matching "${options.search}":\n`);
    console.log('Time'.padEnd(22) + 'Provider'.padEnd(12) + 'Role'.padEnd(10) + 'Preview');
    console.log('-'.repeat(80));

    for (const r of results) {
      console.log(
        (r.timestamp || 'N/A').padEnd(22) +
        r.provider.padEnd(12) +
        r.role.padEnd(10) +
        r.contentPreview.slice(0, 40)
      );
    }

    console.log(`\nTotal: ${results.length} results`);
  });

// Sessions commands
const sessionsCmd = program.command('sessions').description('Session operations');

sessionsCmd
  .command('export')
  .description('Export sessions as JSON or CSV')
  .option('-f, --format <format>', 'Output format: csv or json', 'json')
  .option('-p, --provider <provider>', 'Filter by provider')
  .option('-o, --output <file>', 'Write to file instead of stdout')
  .option('--json', 'Emit export metadata as JSON')
  .action((options: { format: string; provider?: string; output?: string; json?: boolean }, command) => {
    const json = wantsJson(options, command);
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);
    const sessions = getSessions(db, {
      provider: options.provider as Provider | undefined,
      limit: 10_000,
    });

    const format = options.format === 'csv' ? 'csv' : 'json';
    const payload =
      format === 'csv'
        ? usageRowsToCsv(sessions as Array<Record<string, unknown>>)
        : JSON.stringify(sessions, null, 2);

    if (options.output) {
      fs.writeFileSync(options.output, payload);
      if (json) {
        console.log(
          JSON.stringify({ exported: sessions.length, format, path: options.output }, null, 2),
        );
        return;
      }
      console.log(`Exported ${sessions.length} sessions to ${options.output}`);
      return;
    }

    if (json && format === 'json') {
      console.log(payload);
      return;
    }
    if (json) {
      console.log(JSON.stringify({ exported: sessions.length, format, sessions }, null, 2));
      return;
    }
    console.log(payload);
  });

// Warnings command — parser warnings from scan history
program
  .command('warnings')
  .description('List parser warnings from recent scans')
  .option('-n, --limit <number>', 'Maximum warnings to show', '50')
  .option('--scan-run <id>', 'Filter by scan run id')
  .option('--json', 'Output as JSON')
  .action((options: { limit: string; scanRun?: string; json?: boolean }, command) => {
    const json = wantsJson(options, command);
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);
    const warnings = getParserWarnings(db, {
      scanRunId: options.scanRun ? parseInt(options.scanRun, 10) : undefined,
      limit: parseInt(options.limit, 10),
    });

    if (json) {
      console.log(JSON.stringify({ warnings }, null, 2));
      return;
    }

    if (warnings.length === 0) {
      console.log('No parser warnings recorded.');
      return;
    }

    console.log('\nParser warnings:\n');
    for (const w of warnings) {
      const code = w.code ? `[${w.code}] ` : '';
      const line = w.line != null ? `:${w.line}` : '';
      console.log(`  ${w.severity} ${code}${w.file}${line} — ${w.message}`);
    }
  });

// Pricing commands
const pricingCmd = program
  .command('pricing')
  .description('Manage pricing configuration');

pricingCmd
  .command('list')
  .description('List all pricing models')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    let models = getPricingModels(db);
    if (models.length === 0) {
      // Initialize with defaults
      const defaults = getDefaultPricingModels();
      for (const m of defaults) {
        upsertPricingModel(db, {
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
      models = getPricingModels(db);
    }

    if (options.json) {
      console.log(JSON.stringify(models, null, 2));
      return;
    }

    console.log('\nPricing Models:\n');
    console.log('Provider'.padEnd(12) + 'Model'.padEnd(25) + 'Input/M'.padEnd(12) + 'Output/M'.padEnd(12) + 'Cached/M');
    console.log('-'.repeat(75));

    for (const m of models) {
      console.log(
        m.provider.padEnd(12) +
        m.model.padEnd(25) +
        formatCurrency(m.inputPerMillion).padEnd(12) +
        formatCurrency(m.outputPerMillion).padEnd(12) +
        (m.cachedInputPerMillion ? formatCurrency(m.cachedInputPerMillion) : 'N/A')
      );
    }
  });

pricingCmd
  .command('import <file>')
  .description('Import pricing from JSON file')
  .option('--json', 'Output as JSON')
  .action((file: string, options: { json?: boolean }) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(content);
      const models = Array.isArray(parsed) ? parsed : parsed.models;

      if (!Array.isArray(models)) {
        const message =
          'Invalid format: expected an array of pricing models or { "models": [...] }';
        if (options.json) {
          console.log(JSON.stringify({ ok: false, error: message }, null, 2));
          return;
        }
        console.error(message);
        return;
      }

      if (!Array.isArray(parsed) && parsed.modelAliases) {
        console.warn(
          'Note: modelAliases in pricing JSON are not imported automatically. Add them to agent-usage.config.json.',
        );
      }

      let imported = 0;
      for (const m of models) {
        upsertPricingModel(db, {
          provider: m.provider,
          model: m.model,
          inputPerMillion: m.inputPerMillion,
          outputPerMillion: m.outputPerMillion,
          cachedInputPerMillion: m.cachedInputPerMillion,
          cacheWritePerMillion: m.cacheWritePerMillion,
          reasoningPerMillion: m.reasoningPerMillion,
          notes: m.notes,
        });
        imported++;
      }

      if (options.json) {
        console.log(JSON.stringify({ ok: true, imported, file }, null, 2));
        return;
      }
      console.log(`Imported ${imported} pricing models`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
        return;
      }
      console.error(`Failed to import: ${message}`);
    }
  });

pricingCmd
  .command('export')
  .description('Export pricing to JSON')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('--json', 'Output result metadata as JSON (models go to stdout or --output file)')
  .action((options: { output?: string; json?: boolean }) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    const models = getPricingModels(db);
    const json = JSON.stringify(models, null, 2);

    if (options.output) {
      fs.writeFileSync(options.output, json);
      if (options.json) {
        console.log(JSON.stringify({ exported: models.length, path: options.output }, null, 2));
        return;
      }
      console.log(`Exported ${models.length} pricing models to ${options.output}`);
    } else if (options.json) {
      console.log(json);
    } else {
      console.log(json);
    }
  });

// Privacy commands
const privacyCmd = program
  .command('privacy')
  .description('Manage privacy settings');

privacyCmd
  .command('status')
  .description('Show current privacy settings')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    const mode = getSetting(db, 'privacyMode') || config.privacyMode;
    const payload = {
      privacyMode: mode,
      storeRawRecords: config.storeRawRecords,
      estimatePromptOnlySources: config.estimatePromptOnlySources ?? false,
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`\nPrivacy mode: ${mode}`);
    console.log(`Store raw records: ${config.storeRawRecords}`);
    console.log(`Estimate prompt-only sources: ${payload.estimatePromptOnlySources}`);
  });

privacyCmd
  .command('set <mode>')
  .description('Set privacy mode (disabled, preview, full, raw)')
  .option('--json', 'Output as JSON')
  .action((mode: string, options: { json?: boolean }) => {
    if (!['disabled', 'preview', 'full', 'raw'].includes(mode)) {
      const message = 'Invalid mode. Must be: disabled, preview, full, raw';
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
        return;
      }
      console.error(message);
      return;
    }

    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    setSetting(db, 'privacyMode', mode);
    if (options.json) {
      console.log(JSON.stringify({ ok: true, privacyMode: mode }, null, 2));
      return;
    }
    console.log(`Privacy mode set to: ${mode}`);
  });

privacyCmd
  .command('purge-content')
  .description('Permanently purge stored prompt/response/raw content and the search index')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = loadConfig();
    const { sqlite } = initializeDatabase(config.dbPath);

    const result = purgeContent(sqlite);

    if (options.json) {
      console.log(JSON.stringify({ purged: result }, null, 2));
      return;
    }

    console.log(`Purged content from ${result.messages} message row(s).`);
    console.log(`Cleared metadata from ${result.sessions} session row(s).`);
    console.log(`Removed ${result.fts} full-text search entr${result.fts === 1 ? 'y' : 'ies'}.`);
    console.log('Content purged successfully.');
  });

// Watch command
program
  .command('watch')
  .description('Watch for session file changes')
  .option('-p, --provider <provider>', 'Filter by provider')
  .option('--json', 'Emit scan events as JSON lines')
  .action(async (options: { provider?: string; json?: boolean }) => {
    const emit = (event: Record<string, unknown>) => {
      if (options.json) {
        console.log(JSON.stringify({ ...event, timestamp: new Date().toISOString() }));
      }
    };

    if (!options.json) {
      console.log('Watching for session changes... (Press Ctrl+C to stop)');
    } else {
      emit({ event: 'watch_started', provider: options.provider ?? null });
    }

    const chokidar = await import('chokidar');
    const config = loadConfig();
    const database = initializeDatabase(config.dbPath);

    const paths = providersWithParser().flatMap((provider) => {
      const configured = config.providers[provider]?.paths ?? [];
      return configured.length > 0 ? configured : getProviderDefaultPaths(provider);
    });

    const watcher = (chokidar as any).watch(paths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    let debounceTimer: NodeJS.Timeout | null = null;

    const handleChange = async (filePath: string, kind: 'add' | 'change') => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (!options.json) {
          console.log(`Change detected: ${filePath}`);
        } else {
          emit({ event: 'file_changed', kind, path: filePath });
        }
        const result = await scanSessions(database, config, {
          provider: options.provider as Provider | undefined,
          paths: [filePath],
        });
        if (options.json) {
          emit({ event: 'scan_complete', path: filePath, ...result });
        }
      }, 500);
    };

    watcher.on('add', (p: string) => void handleChange(p, 'add'));
    watcher.on('change', (p: string) => void handleChange(p, 'change'));

    // Keep process alive
    await new Promise(() => {});
  });

// Dashboard command — actually launch the local web app.
program
  .command('dashboard')
  .description('Start the local web dashboard')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('-H, --host <host>', 'Host to bind', '127.0.0.1')
  .option('--no-open', 'Do not open the browser automatically')
  .option('--json', 'Output server metadata as JSON')
  .action(async (options: { port: string; host: string; open: boolean; json?: boolean }) => {
    const { spawn } = await import('child_process');
    const { createRequire } = await import('module');
    const target = resolveWebAppTarget();

    if (!target) {
      const message =
        'Could not locate the web dashboard. Build it with "pnpm build" or run from a git checkout.';
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: message }, null, 2));
        return;
      }
      console.error(message);
      return;
    }

    const host = options.host || '127.0.0.1';
    const port = String(options.port);
    const url = `http://${host}:${port}`;

    if (!options.json) {
      const mode = target.kind === 'production' ? 'production build' : 'dev server';
      console.log(`Starting dashboard (${mode}) on ${url} ...`);
    }

    const child =
      target.kind === 'production'
        ? (() => {
            const require = createRequire(path.join(target.webDir, 'package.json'));
            const nextBin = require.resolve('next/dist/bin/next');
            return spawn(process.execPath, [nextBin, 'start', '--hostname', host, '--port', port], {
              cwd: target.webDir,
              stdio: options.json ? 'ignore' : 'inherit',
              env: { ...process.env },
            });
          })()
        : spawn(
            'pnpm',
            ['--filter', '@agent-usage/web', 'dev', '--hostname', host, '--port', port],
            {
              cwd: target.repoRoot,
              stdio: options.json ? 'ignore' : 'inherit',
              env: { ...process.env },
            },
          );

    if (options.open && !options.json) {
      setTimeout(() => void openBrowser(url), 2500);
    }

    if (options.json) {
      // Brief delay so the child process is assigned a pid before we report it.
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log(JSON.stringify({ url, port: Number(port), pid: child.pid ?? null }, null, 2));
    }

    child.on('exit', (code) => process.exit(code ?? 0));
  });

// Providers command — list every known provider, its support level and status.
const providersCmd = program
  .command('providers')
  .description('List supported providers and detection status')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = loadConfig();
    const agents = detectAgentInstallations(config);

    if (options.json) {
      console.log(JSON.stringify(agents, null, 2));
      return;
    }

    console.log('\nProviders:\n');
    console.log(
      'Provider'.padEnd(22) +
        'Status'.padEnd(12) +
        'Parser'.padEnd(8) +
        'Support'.padEnd(22) +
        'Path',
    );
    console.log('-'.repeat(96));
    for (const agent of agents) {
      console.log(
        agent.label.padEnd(22) +
          (agent.installed ? 'detected' : 'not found').padEnd(12) +
          (agent.hasParser ? 'yes' : 'no').padEnd(8) +
          agent.supportLevel.padEnd(22) +
          agent.path,
      );
    }
    console.log(`\n${agents.filter((a) => a.installed).length} of ${agents.length} providers detected.`);
  });

providersCmd
  .command('detect')
  .description('Detect installed providers (machine-readable)')
  .option('--json', 'Output as JSON')
  .action((options, command) => {
    const config = loadConfig();
    const installed = detectAgentInstallations(config).filter((a) => a.installed);
    const json = options.json || command.optsWithGlobals().json;

    if (json) {
      console.log(JSON.stringify({ installed }, null, 2));
      return;
    }

    if (installed.length === 0) {
      console.log('No providers detected.');
      return;
    }
    for (const agent of installed) {
      console.log(`${agent.label} (${agent.provider}) - ${agent.path}`);
    }
  });

// Inspect-schema — open a provider's SQLite store read-only and dump its shape.
program
  .command('inspect-schema')
  .description('Inspect a SQLite-backed provider database read-only (never modifies it)')
  .requiredOption('-p, --provider <provider>', 'Provider id (e.g. opencode, goose, kilo, hermes)')
  .option('-f, --file <path>', 'Explicit DB file (otherwise auto-discovered)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const provider = options.provider as string;
    const def = getProviderDefinition(provider);
    if (!def) {
      console.error(`Unknown provider "${provider}".`);
      return;
    }

    const dbFile = options.file || findSqliteFile(provider);
    if (!dbFile) {
      console.error(
        `No SQLite database found for ${def.label}. Pass --file, or check ${def.detectDirs.join(', ')}.`,
      );
      return;
    }

    const Database = (await import('better-sqlite3')).default;
    let sqlite: import('better-sqlite3').Database | undefined;
    try {
      sqlite = new Database(dbFile, { readonly: true, fileMustExist: true });
      const tables = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;

      const schema = tables.map((t) => {
        const columns = sqlite!
          .prepare(`PRAGMA table_info(${t.name})`)
          .all() as Array<{ name: string; type: string }>;
        return {
          table: t.name,
          columns: columns.map((c) => ({ name: c.name, type: c.type })),
          likelyUsageTable: looksLikeUsageTable(t.name, columns.map((c) => c.name)),
        };
      });

      if (options.json) {
        console.log(JSON.stringify({ provider, file: dbFile, tables: schema }, null, 2));
        return;
      }

      console.log(`\nSchema for ${def.label} (${dbFile}):\n`);
      for (const t of schema) {
        const flag = t.likelyUsageTable ? '  <- likely usage table' : '';
        console.log(`Table: ${t.table}${flag}`);
        for (const c of t.columns) {
          console.log(`    ${c.name} ${c.type}`);
        }
        console.log('');
      }
    } catch (e) {
      console.error(`Failed to inspect: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      sqlite?.close();
    }
  });

// Doctor command
program
  .command('doctor')
  .description('Check system health and configuration')
  .option('-p, --provider <provider>', 'Show setup guidance for a specific provider')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = loadConfig();
    const configValidation = validateConfig();
    const nodeVersion = process.version;
    const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;

    let dbPath = '';
    let dbOk = false;
    let schemaVersion: number | null = null;
    let sqlite: import('better-sqlite3').Database | undefined;
    try {
      const database = initializeDatabase(config.dbPath);
      dbPath = database.path;
      sqlite = database.sqlite;
      dbOk = true;
      schemaVersion = getSchemaVersion(sqlite);
    } catch {
      dbOk = false;
    }

    const agents = detectAgentInstallations(config);
    const providerReport = agents.map((a) => ({
      provider: a.provider,
      label: a.label,
      installed: a.installed,
      hasParser: a.hasParser,
      supportLevel: a.supportLevel,
      path: a.path,
      envVars: a.envVars,
    }));

    if (options.provider) {
      const def = getProviderDefinition(options.provider);
      if (!def) {
        console.error(`Unknown provider "${options.provider}".`);
        return;
      }
      const guidance = providerGuidance(def.id);
      if (options.json) {
        console.log(JSON.stringify({ provider: def.id, label: def.label, guidance }, null, 2));
        return;
      }
      console.log(`\n${def.label} setup\n`);
      for (const line of guidance) console.log(`  ${line}`);
      return;
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            node: { version: nodeVersion, ok: nodeOk },
            database: { path: dbPath, ok: dbOk, schemaVersion },
            config: configValidation,
            providers: providerReport,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log('\nSystem Health Check:\n');
    console.log(`Node.js: ${nodeVersion} ${nodeOk ? '✓' : '✗ (v20+ required)'}`);
    console.log(`Database: ${dbOk ? `${dbPath} ✓` : '✗ failed to open'}`);
    if (configValidation.path) {
      console.log(
        `Config (${configValidation.path}): ${configValidation.ok ? '✓ valid' : '✗ invalid'}`,
      );
      if (configValidation.errors?.length) {
        for (const err of configValidation.errors) {
          console.log(`  - ${err}`);
        }
      }
    } else {
      console.log('Config: using defaults (no config file found)');
    }
    console.log('\nProviders:');
    for (const a of providerReport) {
      console.log(`  ${a.label.padEnd(18)} ${a.installed ? 'detected' : 'not found'}`);
    }
    console.log('\nHealth check complete');
  });

// Seed command for demo mode
program
  .command('seed')
  .description('Generate sample data for demo')
  .option('-n, --sessions <number>', 'Number of sessions to generate', '10')
  .option('--json', 'Output as JSON')
  .action((options: { sessions: string; json?: boolean }) => {
    const config = loadConfig();
    const { sqlite } = initializeDatabase(config.dbPath);

    const count = parseInt(options.sessions, 10);
    if (!options.json) {
      console.log(`Generating ${count} sample sessions...`);
    }

    // Generate sample data
    const providers: Provider[] = ['claude', 'codex', 'gemini'];
    const models = ['gpt-4o', 'claude-sonnet-4-20250514', 'gemini-2.5-pro'];

    const insert = sqlite.prepare(`
      INSERT OR REPLACE INTO sessions (
        id, provider, project_name, started_at, updated_at,
        input_tokens, output_tokens, total_tokens, estimated_cost, model, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < count; i++) {
      const provider = providers[i % providers.length];
      const model = models[i % models.length];
      const sessionId = `demo-session-${i}`;
      const date = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      const inputTokens = Math.floor(Math.random() * 10000) + 1000;
      const outputTokens = Math.floor(Math.random() * 5000) + 500;

      insert.run(
        sessionId,
        provider,
        `demo-project-${i % 5}`,
        date.toISOString(),
        date.toISOString(),
        inputTokens,
        outputTokens,
        inputTokens + outputTokens,
        inputTokens * 0.0000025 + outputTokens * 0.00001,
        model,
        new Date().toISOString(),
      );
    }

    refreshUsageRollups(sqlite);
    if (options.json) {
      console.log(JSON.stringify({ ok: true, sessionsGenerated: count }, null, 2));
      return;
    }
    console.log(`Generated ${count} sample sessions`);
  });

/** Walk up from the CLI location to find the monorepo root (has pnpm-workspace.yaml). */
function usageRowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value);
    return text.includes(',') || text.includes('"') || text.includes('\n')
      ? `"${text.replace(/"/g, '""')}"`
      : text;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

/** Open a URL in the default browser, cross-platform. */
async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import('child_process');
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    // Best effort — the URL is already printed.
  }
}

/** Find the first existing SQLite file among a provider's default paths. */
function findSqliteFile(provider: string): string | null {
  const def = getProviderDefinition(provider);
  if (!def) return null;
  const candidates = [
    ...getProviderDefaultPaths(provider as Provider).filter((p) => p.endsWith('.db')),
    ...def.detectDirs.map((d) => expandPath(d)).filter((d): d is string => Boolean(d)),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Heuristic: does this table look like it holds session/message usage data? */
function looksLikeUsageTable(name: string, columns: string[]): boolean {
  const n = name.toLowerCase();
  const cols = columns.map((c) => c.toLowerCase());
  const nameHit = ['message', 'session', 'usage', 'conversation', 'turn', 'chat'].some((k) =>
    n.includes(k),
  );
  const colHit = cols.some((c) => c.includes('token') || c.includes('cost') || c.includes('model'));
  return nameHit || colHit;
}

/** Provider-specific setup guidance shown by `doctor --provider`. */
function providerGuidance(provider: Provider): string[] {
  const def = getProviderDefinition(provider);
  const base = [
    `Support level: ${def?.supportLevel ?? 'unknown'}`,
    `Default paths: ${def?.defaultPaths.join(', ') ?? '(none)'}`,
    def?.envVars.length ? `Env overrides: ${def.envVars.join(', ')}` : 'Env overrides: (none)',
  ];
  if (provider === 'copilot') {
    base.push(
      'Enable OpenTelemetry export before your sessions:',
      '  export COPILOT_OTEL_ENABLED=true',
      '  export COPILOT_OTEL_EXPORTER_TYPE=file',
      '  export COPILOT_OTEL_FILE_EXPORTER_PATH=~/.copilot/otel/usage.jsonl',
      'Usage from sessions before this was enabled cannot be recovered.',
    );
  }
  if (def && ['opencode', 'goose', 'kilo', 'hermes'].includes(provider)) {
    base.push(`Inspect its schema with: agent-usage inspect-schema --provider ${provider}`);
  }
  return base;
}

type SyncAgent = Provider | 'all';

function parseSyncAgent(value?: string): SyncAgent | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'all') return 'all';
  if (isKnownProvider(normalized) && getProviderDefinition(normalized)?.hasParser) {
    return normalized;
  }
  throw new Error(`Invalid agent "${value}". Use one of: all, ${providersWithParser().join(', ')}.`);
}

async function chooseSyncAgent(
  installed: AgentInstallation[],
  hasCustomPaths: boolean,
  json: boolean,
): Promise<SyncAgent> {
  if (json || !process.stdin.isTTY || installed.length <= 1) {
    return installed[0]?.provider || 'all';
  }

  const choices: Array<{ label: string; value: SyncAgent }> = [
    { label: 'Sync All', value: 'all' },
    ...installed.map((agent) => ({ label: agent.label, value: agent.provider })),
  ];

  console.log('\nChoose what to sync:\n');
  choices.forEach((choice, index) => {
    console.log(`  ${index + 1}. ${choice.label}`);
  });
  if (hasCustomPaths) {
    console.log('\nCustom paths will be included in the selected sync.');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\nSelection: ');
  rl.close();

  const index = Number.parseInt(answer, 10) - 1;
  return choices[index]?.value || 'all';
}

function getSelectedProviders(
  choice: SyncAgent,
  installed: AgentInstallation[],
  hasCustomPaths: boolean,
): Provider[] {
  if (choice === 'all') {
    if (installed.length === 0 && hasCustomPaths) {
      return providersWithParser();
    }
    return installed.map((agent) => agent.provider);
  }
  if (hasCustomPaths) {
    return [choice];
  }
  return installed.some((agent) => agent.provider === choice)
    ? [choice]
    : [];
}

async function syncProviders(
  database: ReturnType<typeof initializeDatabase>,
  config: ReturnType<typeof loadConfig>,
  providers: Provider[],
  customPaths?: string[],
) {
  const aggregate = {
    filesScanned: 0,
    sessionsFound: 0,
    messagesFound: 0,
    warnings: [] as Awaited<ReturnType<typeof scanSessions>>['warnings'],
    errors: [] as string[],
  };

  for (const provider of providers) {
    const result = await scanSessions(database, config, {
      provider,
      paths: customPaths,
    });
    aggregate.filesScanned += result.filesScanned;
    aggregate.sessionsFound += result.sessionsFound;
    aggregate.messagesFound += result.messagesFound;
    aggregate.warnings.push(...result.warnings);
    aggregate.errors.push(...result.errors);
  }

  return aggregate;
}

function formatProviderList(providers: Provider[]) {
  if (providers.length === 0) return 'selected';
  if (providers.length === 1) return providerDisplayName(providers[0]);
  return 'all detected';
}

function providerDisplayName(provider: Provider): string {
  return getProviderDefinition(provider)?.label ?? provider;
}

function createSpinner(label: string) {
  const frames = ['-', '\\', '|', '/'];
  let frame = 0;
  let active = process.stdout.isTTY;

  if (!active) {
    console.log(`${label}...`);
    return {
      stop(status: string) {
        console.log(`${label}: ${status}`);
      },
    };
  }

  process.stdout.write('\x1b[?25l');
  const timer = setInterval(() => {
    process.stdout.write(`\r${frames[frame]} ${label}...`);
    frame = (frame + 1) % frames.length;
  }, 90);

  return {
    stop(status: string) {
      clearInterval(timer);
      process.stdout.write(`\r\x1b[K${label}: ${status}\n`);
      process.stdout.write('\x1b[?25h');
      active = false;
    },
  };
}

program.parse();
