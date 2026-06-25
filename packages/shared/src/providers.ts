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
    supportLevel: 'exact-usage',
    defaultConfidence: 'exact',
    storageKinds: ['jsonl', 'json'],
    envVars: ['CODEX_HOME'],
    defaultPaths: [
      '$CODEX_HOME/sessions/**/*.jsonl',
      '$CODEX_HOME/**/*.jsonl',
      '$CODEX_HOME/**/*.json',
      '~/.codex/sessions/**/*.jsonl',
      '~/.codex/**/*.jsonl',
      '~/.codex/**/*.json',
    ],
    detectDirs: ['$CODEX_HOME', '~/.codex'],
    hasParser: true,
    enabledByDefault: true,
    notes:
      'Exact token usage from token_count events; falls back to text estimation for legacy schemas.',
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
    // Qwen is a Gemini fork; some builds write whole-file JSON
    // (`chats/session-*.json`, per doc §3/§5) and others JSONL. Cover both.
    storageKinds: ['jsonl', 'json'],
    envVars: ['QWEN_DATA_DIR'],
    defaultPaths: [
      '~/.qwen/projects/**/chats/*.jsonl',
      '~/.qwen/tmp/**/chats/*.json',
      '~/.qwen/projects/**/chats/*.json',
    ],
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
    // Doc §8.232: JSONL session logs organized by workspace slug; some builds
    // also emit single `.settings.json`. Cover both.
    storageKinds: ['jsonl', 'json'],
    envVars: ['DROID_SESSIONS_DIR'],
    defaultPaths: ['~/.factory/sessions/**/*.jsonl', '~/.factory/sessions/**/*.settings.json'],
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
    // Doc §8.237: JSONL (VERIFY); some builds use whole-file JSON threads.
    storageKinds: ['jsonl', 'json'],
    envVars: ['AMP_DATA_DIR'],
    defaultPaths: ['~/.local/share/amp/threads/**/*.jsonl', '~/.local/share/amp/threads/**/*.json'],
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
    // Doc §4.146: primary source is per-session events.jsonl under
    // session-state/; the OTel export under otel/ is an opt-in fallback
    // (requires COPILOT_OTEL_ENABLED=true + file exporter). Cover both.
    defaultPaths: ['~/.copilot/session-state/**/events.jsonl', '~/.copilot/otel/*.jsonl'],
    detectDirs: ['~/.copilot'],
    hasParser: true,
    enabledByDefault: true,
    notes:
      'Primary: session-state events.jsonl. Fallback: OTel file export (requires COPILOT_OTEL_ENABLED=true).',
  },
  openclaw: {
    id: 'openclaw',
    label: 'OpenClaw',
    pricingProvider: 'other',
    supportLevel: 'partial-usage',
    defaultConfidence: 'provider-recorded-cost',
    storageKinds: ['jsonl'],
    envVars: ['OPENCLAW_DIR'],
    // Doc §4.127: flat `~/.openclaw/agents/*.jsonl`, plus legacy `.clawdbot`,
    // `.moltbot`, `.moldbot` trees. Cover both the flat layout and a nested
    // `agents/**/sessions/` layout so neither is missed by discovery.
    defaultPaths: [
      '~/.openclaw/agents/**/*.jsonl',
      '~/.clawdbot/agents/**/*.jsonl',
      '~/.moltbot/agents/**/*.jsonl',
      '~/.moldbot/agents/**/*.jsonl',
    ],
    detectDirs: ['~/.openclaw', '~/.clawdbot', '~/.moltbot', '~/.moldbot'],
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
    storageKinds: ['sqlite', 'json'],
    envVars: [],
    // Doc §7.210: per-project .crush/ dir holding a SQLite DB (resolve via
    // `crush dirs data`); also surface the legacy ~/.config/crush/crush.json
    // for detection. Detection only — no stable public token/session schema.
    defaultPaths: ['~/**/.crush/**', '~/.config/crush/crush.json'],
    detectDirs: ['~/.config/crush'],
    hasParser: true,
    enabledByDefault: false,
    notes: 'Detection only — no stable public token/session schema (per-project .crush/ SQLite).',
  },
  grok: {
    id: 'grok',
    label: 'Grok',
    pricingProvider: 'other',
    // Grok's local `signals.json` exposes aggregate context-window token counts
    // (totalTokensBeforeCompaction + contextTokensUsed) with no input/output
    // split and no cost data, so we treat it as prompt-history-only.
    supportLevel: 'prompt-history-only',
    defaultConfidence: 'metadata-only',
    storageKinds: ['json'],
    envVars: ['GROK_DATA_DIR'],
    defaultPaths: ['~/.grok/sessions/**/signals.json'],
    detectDirs: ['~/.grok'],
    hasParser: true,
    enabledByDefault: false,
    notes: 'Aggregate token counts only — no cost, no input/output split.',
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
