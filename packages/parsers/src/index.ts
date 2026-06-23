import type { ProviderParser } from '@agent-usage/shared';
import { crushParser } from './crush.js';
import { specstoryParser } from './specstory.js';
import { aiderParser } from './aider.js';
import { qwenParser } from './qwen.js';
import { kimiParser } from './kimi.js';
import { openclawParser } from './openclaw.js';
import { copilotParser } from './copilot.js';
import { ampParser } from './amp.js';
import { droidParser } from './droid.js';
import { codebuffParser } from './codebuff.js';
import { piAgentParser } from './pi-agent.js';
import { opencodeParser } from './opencode.js';
import { gooseParser } from './goose.js';
import { hermesParser } from './hermes.js';
import { kiloParser } from './kilo.js';
import { cursorParser } from './cursor.js';
import { claudeParser } from './claude.js';
import { geminiParser } from './gemini.js';
import { codexParser } from './codex.js';
import { grokParser } from './grok.js';

/** Order matters: more specific `canParse` matchers first. */
export const parsers: ProviderParser[] = [
  crushParser,
  specstoryParser,
  aiderParser,
  qwenParser,
  kimiParser,
  openclawParser,
  copilotParser,
  ampParser,
  droidParser,
  codebuffParser,
  piAgentParser,
  opencodeParser,
  gooseParser,
  hermesParser,
  kiloParser,
  cursorParser,
  claudeParser,
  geminiParser,
  codexParser,
  grokParser,
];

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
export { qwenParser } from './qwen.js';
export { openclawParser } from './openclaw.js';
export { kimiParser } from './kimi.js';
export { ampParser } from './amp.js';
export { droidParser } from './droid.js';
export { codebuffParser } from './codebuff.js';
export { piAgentParser } from './pi-agent.js';
export { aiderParser } from './aider.js';
export { specstoryParser } from './specstory.js';
export { copilotParser } from './copilot.js';
export { opencodeParser } from './opencode.js';
export { gooseParser } from './goose.js';
export { hermesParser } from './hermes.js';
export { kiloParser } from './kilo.js';
export { cursorParser } from './cursor.js';
export { crushParser } from './crush.js';
export { grokParser } from './grok.js';
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
export type { DiscoveredSource, ParseOptions } from '@agent-usage/shared';
export { sanitizeMessageForPrivacy, shouldStoreRaw } from './parser-helpers.js';
