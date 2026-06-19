import type { Provider, PricingProvider } from './types.js';

/**
 * Centralized provider registry — the single source of truth for everything the
 * app needs to know about an agent: how to detect it, where its sessions live,
 * how confident we can be about its usage data, and how it maps onto pricing.
 *
 * Discovery, scanning, the CLI `providers`/`doctor` commands, and the web
 * Providers page all derive their behavior from this table instead of
 * hardcoding per-provider lists in multiple places.
 *
 * NOTE: this module stays free of Node built-ins (`os`/`path`/`process`) so it
 * can be imported from any runtime. Path placeholders (`~`, `$ENV`) are expanded
 * by the discovery layer (`@agent-usage/parsers`), which has Node types.
 */

/** How much trustworthy usage data a provider exposes. */
export type ProviderSupportLevel =
  | 'exact-usage'
  | 'partial-usage'
  | 'prompt-history-only'
  | 'detected-only'
  | 'unsupported';

/** Per-session confidence in the recorded token/cost numbers. */
export type UsageConfidence =
  | 'exact'
  | 'cumulative-delta'
  | 'provider-recorded-cost'
  | 'estimated-from-text'
  | 'metadata-only'
  | 'unavailable';

/** Physical storage format the provider keeps its sessions in. */
export type ProviderStorageKind = 'jsonl' | 'json' | 'sqlite' | 'markdown' | 'otel' | 'mixed';

export type ProviderDefinition = {
  /** Stable identifier used across config, DB rows, and the CLI. */
  id: Provider;
  /** Human-friendly display name. */
  label: string;
  /** Which pricing table this provider's models are looked up against. */
  pricingProvider: PricingProvider;
  /** How much usage data we can extract today. */
  supportLevel: ProviderSupportLevel;
  /** Default confidence for sessions parsed from this provider. */
  defaultConfidence: UsageConfidence;
  /** Storage formats this provider uses. */
  storageKinds: ProviderStorageKind[];
  /** Environment variables that override the default data directory. */
  envVars: string[];
  /**
   * Glob patterns (with `~`/`$ENV` placeholders) where session files live.
   * Expanded at runtime by the discovery layer.
   */
  defaultPaths: string[];
  /** Base directories whose existence indicates the agent is installed. */
  detectDirs: string[];
  /** Whether a parser is wired up. `false` means detect-only for now. */
  hasParser: boolean;
  /** Whether the provider is enabled for scanning by default. */
  enabledByDefault: boolean;
  /** Short human note shown in `doctor` / docs. */
  notes?: string;
};

export const PROVIDER_REGISTRY: Record<Provider, ProviderDefinition> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    pricingProvider: 'anthropic',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['jsonl'],
    envVars: ['CLAUDE_CONFIG_DIR'],
    defaultPaths: ['~/.claude/projects/**/*.jsonl'],
    detectDirs: ['~/.claude'],
    hasParser: true,
    enabledByDefault: true,
    notes: 'Per-message usage incl. cache creation/read tokens.',
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    pricingProvider: 'openai',
    supportLevel: 'partial-usage',
    defaultConfidence: 'estimated-from-text',
    storageKinds: ['json', 'jsonl'],
    envVars: ['CODEX_HOME'],
    defaultPaths: [
      '$CODEX_HOME/**/*.json',
      '$CODEX_HOME/**/*.jsonl',
      '~/.codex/**/*.json',
      '~/.codex/**/*.jsonl',
    ],
    detectDirs: ['$CODEX_HOME', '~/.codex'],
    hasParser: true,
    enabledByDefault: true,
    notes: 'Token usage when present, otherwise estimated from text.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    pricingProvider: 'google',
    supportLevel: 'partial-usage',
    defaultConfidence: 'estimated-from-text',
    storageKinds: ['json'],
    envVars: ['GEMINI_DATA_DIR'],
    defaultPaths: ['~/.gemini/tmp/**/chats/**/*'],
    detectDirs: ['~/.gemini'],
    hasParser: true,
    enabledByDefault: true,
    notes: 'usageMetadata token counts when present.',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    pricingProvider: 'other',
    supportLevel: 'partial-usage',
    defaultConfidence: 'exact',
    storageKinds: ['sqlite', 'json'],
    envVars: ['OPENCODE_DATA_DIR'],
    defaultPaths: ['~/.local/share/opencode/**/*.db', '~/.local/share/opencode/storage/**/*.json'],
    detectDirs: ['~/.local/share/opencode'],
    hasParser: true,
    enabledByDefault: true,
  },
  qwen: {
    id: 'qwen',
    label: 'Qwen Code',
    pricingProvider: 'qwen',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['jsonl'],
    envVars: ['QWEN_DATA_DIR'],
    defaultPaths: ['~/.qwen/projects/**/chats/*.jsonl'],
    detectDirs: ['~/.qwen'],
    hasParser: true,
    enabledByDefault: true,
  },
  goose: {
    id: 'goose',
    label: 'Goose',
    pricingProvider: 'other',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['sqlite'],
    envVars: ['GOOSE_PATH_ROOT'],
    defaultPaths: ['~/.local/share/goose/sessions/sessions.db'],
    detectDirs: ['~/.local/share/goose', '~/.local/share/Block/goose'],
    hasParser: true,
    enabledByDefault: true,
  },
  droid: {
    id: 'droid',
    label: 'Factory Droid',
    pricingProvider: 'other',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['json'],
    envVars: ['DROID_SESSIONS_DIR'],
    defaultPaths: ['~/.factory/sessions/**/*.settings.json'],
    detectDirs: ['~/.factory'],
    hasParser: true,
    enabledByDefault: true,
  },
  amp: {
    id: 'amp',
    label: 'Amp',
    pricingProvider: 'other',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['json'],
    envVars: ['AMP_DATA_DIR'],
    defaultPaths: ['~/.local/share/amp/threads/**/*.json'],
    detectDirs: ['~/.local/share/amp'],
    hasParser: true,
    enabledByDefault: true,
  },
  codebuff: {
    id: 'codebuff',
    label: 'Codebuff',
    pricingProvider: 'other',
    supportLevel: 'partial-usage',
    defaultConfidence: 'exact',
    storageKinds: ['json'],
    envVars: ['CODEBUFF_DATA_DIR'],
    defaultPaths: ['~/.config/manicode/projects/**/chats/**/chat-messages.json'],
    detectDirs: ['~/.config/manicode'],
    hasParser: true,
    enabledByDefault: true,
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi CLI',
    pricingProvider: 'moonshot',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['jsonl'],
    envVars: ['KIMI_DATA_DIR'],
    defaultPaths: ['~/.kimi/sessions/**/wire.jsonl'],
    detectDirs: ['~/.kimi'],
    hasParser: true,
    enabledByDefault: true,
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    pricingProvider: 'openai',
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['otel'],
    envVars: ['COPILOT_OTEL_FILE_EXPORTER_PATH'],
    defaultPaths: ['~/.copilot/otel/*.jsonl'],
    detectDirs: ['~/.copilot'],
    hasParser: true,
    enabledByDefault: true,
    notes: 'Requires COPILOT_OTEL_ENABLED=true and a file exporter.',
  },
  openclaw: {
    id: 'openclaw',
    label: 'OpenClaw',
    pricingProvider: 'other',
    supportLevel: 'partial-usage',
    defaultConfidence: 'provider-recorded-cost',
    storageKinds: ['jsonl'],
    envVars: ['OPENCLAW_DIR'],
    defaultPaths: ['~/.openclaw/agents/**/sessions/*.jsonl'],
    detectDirs: ['~/.openclaw', '~/.clawdbot'],
    hasParser: true,
    enabledByDefault: true,
  },
  hermes: {
    id: 'hermes',
    label: 'Hermes Agent',
    pricingProvider: 'other',
    supportLevel: 'exact-usage',
    defaultConfidence: 'provider-recorded-cost',
    storageKinds: ['sqlite'],
    envVars: ['HERMES_HOME'],
    defaultPaths: ['~/.hermes/state.db'],
    detectDirs: ['~/.hermes'],
    hasParser: true,
    enabledByDefault: true,
  },
  'pi-agent': {
    id: 'pi-agent',
    label: 'pi-agent',
    pricingProvider: 'other',
    supportLevel: 'partial-usage',
    defaultConfidence: 'exact',
    storageKinds: ['jsonl', 'json'],
    envVars: ['PI_AGENT_DIR'],
    defaultPaths: ['~/.pi/agent/sessions/**/*.jsonl', '~/.pi/agent/sessions/**/*.json'],
    detectDirs: ['~/.pi/agent'],
    hasParser: true,
    enabledByDefault: true,
  },
  kilo: {
    id: 'kilo',
    label: 'Kilo',
    pricingProvider: 'other',
    supportLevel: 'exact-usage',
    defaultConfidence: 'provider-recorded-cost',
    storageKinds: ['sqlite'],
    envVars: ['KILO_DATA_DIR'],
    defaultPaths: ['~/.local/share/kilo/kilo.db'],
    detectDirs: ['~/.local/share/kilo'],
    hasParser: true,
    enabledByDefault: true,
  },
  aider: {
    id: 'aider',
    label: 'Aider',
    pricingProvider: 'other',
    supportLevel: 'prompt-history-only',
    defaultConfidence: 'metadata-only',
    storageKinds: ['markdown'],
    envVars: ['AIDER_CHAT_HISTORY_FILE', 'AIDER_INPUT_HISTORY_FILE', 'AIDER_LLM_HISTORY_FILE'],
    defaultPaths: ['~/**/.aider.chat.history.md', '~/**/.aider.input.history'],
    detectDirs: [],
    hasParser: true,
    enabledByDefault: false,
    notes: 'Prompt history only — never invents token usage.',
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor CLI',
    pricingProvider: 'other',
    supportLevel: 'prompt-history-only',
    defaultConfidence: 'metadata-only',
    storageKinds: ['sqlite', 'markdown'],
    envVars: ['CURSOR_DATA_DIR'],
    defaultPaths: ['~/.cursor/**/state.vscdb'],
    detectDirs: ['~/.cursor'],
    hasParser: true,
    enabledByDefault: false,
  },
  specstory: {
    id: 'specstory',
    label: 'SpecStory',
    pricingProvider: 'other',
    supportLevel: 'prompt-history-only',
    defaultConfidence: 'metadata-only',
    storageKinds: ['markdown'],
    envVars: [],
    defaultPaths: ['~/**/.specstory/history/**/*.md'],
    detectDirs: [],
    hasParser: true,
    enabledByDefault: false,
  },
  crush: {
    id: 'crush',
    label: 'Crush',
    pricingProvider: 'other',
    supportLevel: 'detected-only',
    defaultConfidence: 'unavailable',
    storageKinds: ['json'],
    envVars: [],
    defaultPaths: ['~/.config/crush/crush.json'],
    detectDirs: ['~/.config/crush'],
    hasParser: true,
    enabledByDefault: false,
    notes: 'Detection only — no stable public token/session schema.',
  },
};

/** All registered provider ids, in registry order. */
export function listProviderIds(): Provider[] {
  return Object.keys(PROVIDER_REGISTRY) as Provider[];
}

/** All provider definitions, in registry order. */
export function listProviders(): ProviderDefinition[] {
  return listProviderIds().map((id) => PROVIDER_REGISTRY[id]);
}

/** Returns the definition for a provider, or undefined if not registered. */
export function getProviderDefinition(id: string): ProviderDefinition | undefined {
  return (PROVIDER_REGISTRY as Record<string, ProviderDefinition>)[id];
}

/** Type guard: is this string a registered provider id? */
export function isKnownProvider(id: string): id is Provider {
  return id in PROVIDER_REGISTRY;
}

/** Providers that have a working parser wired up. */
export function providersWithParser(): Provider[] {
  return listProviders()
    .filter((p) => p.hasParser)
    .map((p) => p.id);
}
