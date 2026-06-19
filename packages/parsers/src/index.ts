import type { ProviderParser } from '@agent-usage/shared';
import { claudeParser } from './claude.js';
import { geminiParser } from './gemini.js';
import { codexParser } from './codex.js';

export const parsers: ProviderParser[] = [claudeParser, geminiParser, codexParser];

export function getParserForFile(filePath: string, sample: string): ProviderParser | null {
  for (const parser of parsers) {
    if (parser.canParse(filePath, sample)) {
      return parser;
    }
  }
  return null;
}

export function getParserByProvider(provider: string): ProviderParser | null {
  return parsers.find((p) => p.provider === provider) || null;
}

export { claudeParser } from './claude.js';
export { geminiParser } from './gemini.js';
export { codexParser } from './codex.js';
export {
  detectAgentInstallations,
  discoverSessionFiles,
  getInstalledProviders,
  getProviderBasePath,
  getProviderPaths,
  getProviderDefaultPaths,
  detectProvider,
  expandPath,
} from './discovery.js';
export type { AgentInstallation, DiscoveredFile } from './discovery.js';
