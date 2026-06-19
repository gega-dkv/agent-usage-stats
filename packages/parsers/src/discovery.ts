import fs from 'fs';
import path from 'path';
import os from 'os';
import { glob } from 'glob';
import type {
  Provider,
  AppConfig,
  ProviderDefinition,
  ProviderSupportLevel,
} from '@agent-usage/shared';
import { listProviders, getProviderDefinition, providersWithParser } from '@agent-usage/shared';

export type DiscoveredFile = {
  path: string;
  provider: Provider;
};

export type AgentInstallation = {
  provider: Provider;
  label: string;
  path: string;
  installed: boolean;
  hasParser: boolean;
  supportLevel: ProviderSupportLevel;
  envVars: string[];
  sessionPatterns: string[];
};

/**
 * Expand `~` and `$ENV` placeholders in a registry path pattern.
 * Returns `null` when the pattern references an environment variable that is
 * not set (so we don't accidentally glob from the filesystem root).
 */
export function expandPath(pattern: string): string | null {
  let result = pattern;

  if (result.startsWith('~')) {
    result = path.join(os.homedir(), result.slice(1));
  }

  // Replace $VAR / ${VAR} tokens with their environment values.
  let missingEnv = false;
  result = result.replace(/\$\{?([A-Z0-9_]+)\}?/g, (_match, name: string) => {
    const value = process.env[name];
    if (!value) {
      missingEnv = true;
      return '';
    }
    return value;
  });

  return missingEnv ? null : result;
}

function expandPatterns(patterns: string[]): string[] {
  return patterns
    .map(expandPath)
    .filter((p): p is string => p != null && p.length > 0);
}

/** Resolved glob patterns where a provider's sessions may live. */
export function getProviderDefaultPaths(provider: Provider): string[] {
  const def = getProviderDefinition(provider);
  return def ? expandPatterns(def.defaultPaths) : [];
}

/** @deprecated kept for compatibility — prefer getProviderDefaultPaths. */
export function getProviderPaths(provider: Provider): string[] {
  return getProviderDefaultPaths(provider);
}

/** Best-effort base directory for a provider (used by `doctor`/`sync`). */
export function getProviderBasePath(provider: Provider): string {
  const def = getProviderDefinition(provider);
  const dirs = def ? expandPatterns(def.detectDirs) : [];
  if (dirs.length > 0) return dirs[0];
  // Fall back to the first non-glob path segment.
  const paths = getProviderDefaultPaths(provider);
  return paths[0] ? paths[0].split(/[*{[]/)[0] : path.join(os.homedir(), `.${provider}`);
}

function providerConfig(config: AppConfig | undefined, provider: Provider) {
  return config?.providers?.[provider];
}

function isProviderEnabled(config: AppConfig | undefined, def: ProviderDefinition): boolean {
  const override = providerConfig(config, def.id);
  return override ? override.enabled : def.enabledByDefault;
}

/** True when any of a provider's detect dirs (or configured paths) exist. */
function providerInstalled(config: AppConfig | undefined, def: ProviderDefinition): boolean {
  const detectDirs = expandPatterns(def.detectDirs);
  if (detectDirs.some((dir) => fs.existsSync(dir))) return true;

  const configuredPaths = providerConfig(config, def.id)?.paths ?? [];
  return configuredPaths.some(pathLooksInstalled);
}

export function detectAgentInstallations(config?: AppConfig): AgentInstallation[] {
  return listProviders().map((def) => {
    const configuredPaths = providerConfig(config, def.id)?.paths ?? [];
    const sessionPatterns =
      configuredPaths.length > 0 ? configuredPaths : getProviderDefaultPaths(def.id);

    return {
      provider: def.id,
      label: def.label,
      path: getProviderBasePath(def.id),
      installed: providerInstalled(config, def),
      hasParser: def.hasParser,
      supportLevel: def.supportLevel,
      envVars: def.envVars,
      sessionPatterns,
    };
  });
}

export function getInstalledProviders(config?: AppConfig): Provider[] {
  return detectAgentInstallations(config)
    .filter((agent) => agent.installed)
    .map((agent) => agent.provider);
}

export async function discoverSessionFiles(
  config: AppConfig,
  customPaths?: string[],
): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];
  const seen = new Set<string>();

  const addMatch = (match: string, provider: Provider) => {
    if (seen.has(match)) return;
    seen.add(match);
    files.push({ path: match, provider });
  };

  const globPattern = async (pattern: string): Promise<string[]> => {
    try {
      return await glob(pattern, {
        absolute: true,
        nodir: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
    } catch {
      return [];
    }
  };

  if (customPaths?.length) {
    for (const pattern of customPaths.map(resolvePattern)) {
      for (const match of await globPattern(pattern)) {
        addMatch(match, detectProvider(match));
      }
    }
    return files;
  }

  // Only providers that have a parser are globbed during a normal scan; the rest
  // are surfaced via detection (Providers page / doctor) without spamming
  // "no parser" warnings for large home-directory trees.
  const parserProviders = new Set(providersWithParser());

  for (const def of listProviders()) {
    if (!parserProviders.has(def.id)) continue;
    if (!isProviderEnabled(config, def)) continue;

    const configuredPaths = providerConfig(config, def.id)?.paths ?? [];
    const patterns = [...configuredPaths.map(resolvePattern), ...getProviderDefaultPaths(def.id)];

    for (const pattern of patterns) {
      for (const match of await globPattern(pattern)) {
        addMatch(match, def.id);
      }
    }
  }

  for (const pattern of (config.customPaths ?? []).map(resolvePattern)) {
    for (const match of await globPattern(pattern)) {
      addMatch(match, detectProvider(match));
    }
  }

  return files;
}

function pathLooksInstalled(pattern: string): boolean {
  const expanded = expandPath(pattern);
  if (!expanded) return false;
  const staticPath = expanded.split(/[*{[]/)[0];
  const resolved = staticPath.endsWith(path.sep) ? staticPath.slice(0, -1) : staticPath;
  return resolved.length > 0 && fs.existsSync(resolved);
}

function resolvePattern(pattern: string): string {
  const expanded = expandPath(pattern) ?? pattern;
  return path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
}

/** Detect a provider from a file path (and, as a fallback, its contents). */
export function detectProvider(filePath: string): Provider {
  const lower = filePath.toLowerCase();

  if (lower.includes('crush') && (lower.endsWith('crush.json') || lower.endsWith('crush.log'))) {
    return 'crush';
  }
  if (lower.includes('.specstory/')) return 'specstory';
  if (lower.includes('.aider.')) return 'aider';
  if (lower.includes('.qwen/') || lower.includes('/.qwen')) return 'qwen';
  if (lower.includes('wire.jsonl') && lower.includes('.kimi')) return 'kimi';
  if (
    lower.includes('.openclaw') ||
    lower.includes('.clawdbot') ||
    lower.includes('.moltbot') ||
    lower.includes('.moldbot')
  ) {
    return 'openclaw';
  }
  if (lower.includes('/.copilot/otel/')) return 'copilot';
  if (lower.includes('/.local/share/amp/')) return 'amp';
  if (lower.includes('.factory/') && lower.endsWith('.settings.json')) return 'droid';
  if (lower.includes('chat-messages.json')) return 'codebuff';
  if (lower.includes('.pi/agent')) return 'pi-agent';
  if (lower.includes('opencode')) return 'opencode';
  if (lower.includes('goose') && lower.endsWith('sessions.db')) return 'goose';
  if (lower.includes('hermes') && lower.endsWith('.db')) return 'hermes';
  if (lower.includes('/kilo/') && lower.endsWith('.db')) return 'kilo';
  if (lower.includes('.cursor') && lower.endsWith('state.vscdb')) return 'cursor';

  // Match against registry detect-dir hints (e.g. ".claude", ".gemini").
  for (const def of listProviders()) {
    for (const dir of def.detectDirs) {
      const leaf = dir.replace(/^~\//, '').replace(/^~/, '').replace(/^\$[A-Z0-9_]+\//, '');
      if (leaf && filePath.includes(leaf)) return def.id;
    }
  }

  try {
    const sample = fs.readFileSync(filePath, 'utf-8').slice(0, 1024);
    if (sample.includes('"session_id"') && sample.includes('"uuid"')) return 'claude';
    if (sample.includes('"chatId"') || sample.includes('"usageMetadata"')) return 'gemini';
    if (sample.includes('"StatusUpdate"') && sample.includes('token_usage')) return 'kimi';
    if (sample.includes('gen_ai.usage')) return 'copilot';
  } catch {
    // Ignore unreadable files.
  }

  return 'codex';
}
