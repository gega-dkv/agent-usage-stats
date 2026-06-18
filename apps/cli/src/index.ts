#!/usr/bin/env node

import { Command } from 'commander';
import { initializeDatabase } from '@agent-usage/db';
import {
  getDailyUsage,
  getMonthlyUsage,
  getStatsSummary,
  searchMessages,
  getPricingModels,
  upsertPricingModel,
  getSetting,
  setSetting,
} from '@agent-usage/db';
import { scanSessions, loadConfig } from '@agent-usage/core';
import { detectAgentInstallations } from '@agent-usage/parsers';
import type { AgentInstallation } from '@agent-usage/parsers';
import { getDefaultPricingModels } from '@agent-usage/pricing';
import { formatNumber, formatCurrency } from '@agent-usage/shared';
import type { Provider } from '@agent-usage/shared';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline/promises';

const program = new Command();

program
  .name('agent-usage')
  .description('Local-first AI session usage analyzer')
  .version('0.1.0');

// Scan command
program
  .command('scan')
  .description('Scan session files from supported AI tools')
  .option('-p, --provider <provider>', 'Filter by provider (claude, codex, gemini)')
  .option('--path <paths...>', 'Custom paths to scan')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const config = loadConfig();
    const database = initializeDatabase(config.dbPath);

    console.log('Scanning session files...\n');

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
    const agents = detectAgentInstallations(config);
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
program
  .command('stats')
  .description('Show usage statistics')
  .option('-d, --day', 'Show daily stats')
  .option('-m, --month', 'Show monthly stats')
  .option('-y, --year', 'Show yearly stats')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    if (options.day || options.month || options.year) {
      let data;
      if (options.day) {
        data = getDailyUsage(db, { from: options.from, to: options.to });
      } else if (options.month) {
        data = getMonthlyUsage(db, { from: options.from, to: options.to });
      } else {
        // Yearly - use monthly and group
        data = getMonthlyUsage(db, { from: options.from, to: options.to });
      }

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log('\nUsage Statistics:\n');
      console.log('Date'.padEnd(15) + 'Provider'.padEnd(12) + 'Sessions'.padEnd(10) + 'Tokens'.padEnd(12) + 'Cost');
      console.log('-'.repeat(65));

      for (const row of data) {
        const r = row as any;
        const date = r.date ?? r.month ?? r.year ?? 'N/A';
        console.log(
          String(date).padEnd(15) +
          String(r.provider).padEnd(12) +
          String(r.sessions).padEnd(10) +
          formatNumber(Number(r.totalTokens) || 0).padEnd(12) +
          formatCurrency(Number(r.estimatedCost) || 0)
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
  .action((file: string) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    try {
      const content = fs.readFileSync(file, 'utf-8');
      const models = JSON.parse(content);

      if (!Array.isArray(models)) {
        console.error('Invalid format: expected an array of pricing models');
        return;
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

      console.log(`Imported ${imported} pricing models`);
    } catch (e) {
      console.error(`Failed to import: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

pricingCmd
  .command('export')
  .description('Export pricing to JSON')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action((options) => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    const models = getPricingModels(db);
    const json = JSON.stringify(models, null, 2);

    if (options.output) {
      fs.writeFileSync(options.output, json);
      console.log(`Exported ${models.length} pricing models to ${options.output}`);
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
  .action(() => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    const mode = getSetting(db, 'privacyMode') || config.privacyMode;
    console.log(`\nPrivacy mode: ${mode}`);
    console.log(`Store raw records: ${config.storeRawRecords}`);
  });

privacyCmd
  .command('set <mode>')
  .description('Set privacy mode (disabled, preview, full, raw)')
  .action((mode: string) => {
    if (!['disabled', 'preview', 'full', 'raw'].includes(mode)) {
      console.error('Invalid mode. Must be: disabled, preview, full, raw');
      return;
    }

    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    setSetting(db, 'privacyMode', mode);
    console.log(`Privacy mode set to: ${mode}`);
  });

privacyCmd
  .command('purge-content')
  .description('Purge stored prompt/response content')
  .action(() => {
    const config = loadConfig();
    const { db } = initializeDatabase(config.dbPath);

    // This would need to clear content_text, raw fields from messages
    console.log('Purging stored content...');
    db.run("UPDATE messages SET content_text = NULL, raw = NULL");
    console.log('Content purged successfully');
  });

// Watch command
program
  .command('watch')
  .description('Watch for session file changes')
  .option('-p, --provider <provider>', 'Filter by provider')
  .action(async (options) => {
    console.log('Watching for session changes... (Press Ctrl+C to stop)');

    const chokidar = await import('chokidar');
    const config = loadConfig();
    const database = initializeDatabase(config.dbPath);

    const paths = [
      ...(config.providers.claude.paths.length > 0 ? config.providers.claude.paths : [path.join(os.homedir(), '.claude', 'projects', '**', '*.jsonl')]),
      ...(config.providers.gemini.paths.length > 0 ? config.providers.gemini.paths : [path.join(os.homedir(), '.gemini', 'tmp', '**', 'chats', '**', '*')]),
      ...(config.providers.codex.paths.length > 0 ? config.providers.codex.paths : [path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), '**', '*')]),
    ];

    const watcher = (chokidar as any).watch(paths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    let debounceTimer: NodeJS.Timeout | null = null;

    const handleChange = async (filePath: string) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        console.log(`Change detected: ${filePath}`);
        await scanSessions(database, config, {
          provider: options.provider as Provider | undefined,
          paths: [filePath],
        });
      }, 500);
    };

    watcher.on('add', handleChange);
    watcher.on('change', handleChange);

    // Keep process alive
    await new Promise(() => {});
  });

// Dashboard command
program
  .command('dashboard')
  .description('Open web dashboard')
  .action(() => {
    console.log('Starting web dashboard...');
    // This would start the Next.js server
    console.log('Run "pnpm dev" from the project root to start the dashboard');
  });

// Doctor command
program
  .command('doctor')
  .description('Check system health and configuration')
  .action(() => {
    console.log('\nSystem Health Check:\n');

    // Check Node.js version
    const nodeVersion = process.version;
    console.log(`Node.js: ${nodeVersion} ${nodeVersion >= 'v20.0.0' ? '✓' : '✗ (v20+ required)'}`);

    // Check database
    try {
      const config = loadConfig();
      const { path: dbPath } = initializeDatabase(config.dbPath);
      console.log(`Database: ${dbPath} ✓`);
    } catch (e) {
      console.log(`Database: ✗ ${e instanceof Error ? e.message : String(e)}`);
    }

    // Check provider directories
    const providers = [
      { name: 'Claude', path: path.join(os.homedir(), '.claude') },
      { name: 'Gemini', path: path.join(os.homedir(), '.gemini') },
      { name: 'Codex', path: process.env.CODEX_HOME || path.join(os.homedir(), '.codex') },
    ];

    for (const p of providers) {
      const exists = fs.existsSync(p.path);
      console.log(`${p.name}: ${exists ? '✓' : 'Not found'}`);
    }

    console.log('\nHealth check complete');
  });

// Seed command for demo mode
program
  .command('seed')
  .description('Generate sample data for demo')
  .option('-n, --sessions <number>', 'Number of sessions to generate', '10')
  .action((options) => {
    const config = loadConfig();
    const { sqlite } = initializeDatabase(config.dbPath);

    const count = parseInt(options.sessions);
    console.log(`Generating ${count} sample sessions...`);

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
        (inputTokens * 0.0000025 + outputTokens * 0.00001),
        model,
        new Date().toISOString(),
      );
    }

    console.log(`Generated ${count} sample sessions`);
  });

type SyncAgent = Provider | 'all';

function parseSyncAgent(value?: string): SyncAgent | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'all' || normalized === 'codex' || normalized === 'claude' || normalized === 'gemini') {
    return normalized;
  }
  throw new Error(`Invalid agent "${value}". Use all, codex, claude, or gemini.`);
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
      return ['codex', 'claude', 'gemini'];
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
  const labels: Record<Provider, string> = {
    claude: 'Claude',
    codex: 'Codex',
    gemini: 'Gemini',
  };
  return labels[provider];
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
