import fs from 'fs';
import path from 'path';
import os from 'os';
import { glob } from 'glob';
import type { Provider, AppConfig } from '@agent-usage/shared';

export type DiscoveredFile = {
  path: string;
  provider: Provider;
};

export type AgentInstallation = {
  provider: Provider;
  label: string;
  path: string;
  installed: boolean;
  sessionPatterns: string[];
};

const DEFAULT_PATHS: Record<Provider, string[]> = {
  claude: [path.join(os.homedir(), '.claude', 'projects', '**', '*.jsonl')],
  gemini: [path.join(os.homedir(), '.gemini', 'tmp', '**', 'chats', '**', '*')],
  codex: getCodexPaths(),
};

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

function getCodexPaths(): string[] {
  const base = getProviderBasePath('codex');

  return [
    path.join(base, '**', '*.json'),
    path.join(base, '**', '*.jsonl'),
    path.join(base, '**', '*.transcript'),
    path.join(base, '**', '*.conversation'),
    path.join(base, '**', '*.history'),
    path.join(base, '**', '*session*'),
  ];
}

export function getProviderBasePath(provider: Provider): string {
  if (provider === 'codex') {
    return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  }
  return path.join(os.homedir(), `.${provider}`);
}

export function detectAgentInstallations(config?: AppConfig): AgentInstallation[] {
  const providers: Provider[] = ['codex', 'claude', 'gemini'];

  return providers.map((provider) => {
    const basePath = getProviderBasePath(provider);
    const configuredPaths = config?.providers[provider]?.paths ?? [];
    const sessionPatterns = configuredPaths.length > 0 ? configuredPaths : DEFAULT_PATHS[provider];

    return {
      provider,
      label: PROVIDER_LABELS[provider],
      path: basePath,
      installed: fs.existsSync(basePath) || configuredPaths.some(pathLooksInstalled),
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

  if (customPaths?.length) {
    for (const pattern of customPaths.map(resolvePattern)) {
      try {
        const matches = await glob(pattern, {
          absolute: true,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });

        for (const match of matches) {
          if (!files.some((f) => f.path === match)) {
            files.push({ path: match, provider: detectProvider(match) });
          }
        }
      } catch {
        // Pattern might not exist, skip silently
      }
    }

    return files;
  }

  const providers: Provider[] = ['claude', 'codex', 'gemini'];

  for (const provider of providers) {
    if (!config.providers[provider].enabled) continue;

    const paths = [
      ...config.providers[provider].paths,
      ...DEFAULT_PATHS[provider],
    ];

    for (const pattern of paths) {
      try {
        const matches = await glob(pattern, {
          absolute: true,
          nodir: true,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });

        for (const match of matches) {
          // Avoid duplicates
          if (!files.some((f) => f.path === match)) {
            files.push({ path: match, provider });
          }
        }
      } catch {
        // Pattern might not exist, skip silently
      }
    }
  }

  // Add custom paths
  if (!customPaths?.length && config.customPaths) {
    for (const pattern of config.customPaths.map(resolvePattern)) {
      try {
        const matches = await glob(pattern, {
          absolute: true,
          nodir: true,
        });

        for (const match of matches) {
          // Try to detect provider from path
          const provider = detectProvider(match);
          if (!files.some((f) => f.path === match)) {
            files.push({ path: match, provider });
          }
        }
      } catch {
        // Skip silently
      }
    }
  }

  return files;
}

function pathLooksInstalled(pattern: string): boolean {
  const staticPath = pattern.split(/[*{[]/)[0];
  const resolved = staticPath.endsWith(path.sep) ? staticPath.slice(0, -1) : staticPath;
  return resolved.length > 0 && fs.existsSync(resolved);
}

function resolvePattern(pattern: string): string {
  return path.isAbsolute(pattern) ? pattern : path.resolve(pattern);
}

function detectProvider(filePath: string): Provider {
  if (filePath.includes('.claude')) return 'claude';
  if (filePath.includes('.gemini')) return 'gemini';
  if (filePath.includes('.codex')) return 'codex';

  // Try to detect from content
  try {
    const sample = fs.readFileSync(filePath, 'utf-8').slice(0, 1024);
    if (sample.includes('"session_id"') && sample.includes('"uuid"')) return 'claude';
    if (sample.includes('"chatId"') || sample.includes('"usageMetadata"')) return 'gemini';
  } catch {
    // Ignore
  }

  return 'codex';
}

export function getProviderPaths(provider: Provider): string[] {
  return DEFAULT_PATHS[provider];
}
