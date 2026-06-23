import type { ModelAliasEntry, ModelAliasMap, PricingProvider } from '@agent-usage/shared';

export type ResolvedModelAlias = {
  model: string;
  provider: PricingProvider;
  aliasUsed?: string;
};

const PREFIX_PROVIDERS: Record<string, PricingProvider> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  gemini: 'google',
  vertex: 'google',
  qwen: 'qwen',
  moonshot: 'moonshot',
  kimi: 'moonshot',
};

/** Built-in aliases for common provider model name variants. */
export const DEFAULT_MODEL_ALIASES: ModelAliasMap = {
  // OpenAI ChatGPT / consumer aliases
  'chatgpt-4o': 'gpt-4o',
  'chatgpt-4o-latest': 'gpt-4o',
  'chatgpt-4o-mini': 'gpt-4o-mini',
  'chatgpt-4o-mini-latest': 'gpt-4o-mini',
  'chatgpt-4.1': 'gpt-4.1',
  'chatgpt-4.1-mini': 'gpt-4.1-mini',
  'chatgpt-4.1-nano': 'gpt-4.1-nano',
  'chatgpt-5.5': 'gpt-5.5',
  'chatgpt-5.5-pro': 'gpt-5.5-pro',
  'chatgpt-5.4': 'gpt-5.4',
  'chatgpt-5.4-mini': 'gpt-5.4-mini',
  'chatgpt-5.4-nano': 'gpt-5.4-nano',
  'chatgpt-5.4-pro': 'gpt-5.4-pro',
  'chatgpt-5.3-codex': 'gpt-5.3-codex',
  // OpenAI model family shorthands
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.5-pro': 'gpt-5.5-pro',
  'gpt-5.4': 'gpt-5.4',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4-nano': 'gpt-5.4-nano',
  'gpt-5.4-pro': 'gpt-5.4-pro',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'codex-mini': 'codex-mini-latest',
  // Anthropic shorthand aliases (map to current generation)
  'claude-fable-5': 'claude-fable-5',
  'claude-mythos-5': 'claude-mythos-5',
  'claude-opus-4': 'claude-opus-4-8',
  'claude-opus-4-1': 'claude-opus-4-1-20250805',
  'claude-opus-4-5': 'claude-opus-4-5',
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-opus-4-8': 'claude-opus-4-8',
  'claude-sonnet-4': 'claude-sonnet-4-6',
  'claude-sonnet-4-5': 'claude-sonnet-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-3-7-sonnet': 'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-latest': 'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku': 'claude-3-5-haiku-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  // Gemini aliases
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.0-flash-exp': 'gemini-2.0-flash',
  'gemini-1.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-flash': 'gemini-2.5-flash',
  'gemini-3.1-pro': 'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  // Qwen aliases
  'qwen-max-latest': 'qwen-max',
  'qwen-plus-latest': 'qwen-plus',
  'qwen-turbo-latest': 'qwen-turbo',
  // Moonshot / Kimi aliases
  'kimi-latest': { target: 'moonshot-v1-128k', provider: 'moonshot' },
  'kimi-k2': { target: 'moonshot-v1-128k', provider: 'moonshot' },
};

type PatternAlias = {
  pattern: RegExp;
  resolve: (
    match: RegExpMatchArray,
    provider: PricingProvider,
  ) => { model: string; provider?: PricingProvider } | null;
};

const PATTERN_ALIASES: PatternAlias[] = [
  // OpenAI dated snapshots
  {
    pattern: /^(gpt-4o(?:-mini)?)-\d{4}-\d{2}-\d{2}$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gpt-4\.1(?:-(?:mini|nano))?(?:-preview)?)-\d{4}-\d{2}-\d{2}$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase().replace(/-preview$/, '') }),
  },
  {
    pattern: /^gpt-5\.5(-pro)?-\d{4}-\d{2}-\d{2}$/i,
    resolve: (match) => ({ model: match[1] ? 'gpt-5.5-pro' : 'gpt-5.5' }),
  },
  {
    pattern: /^gpt-5\.4((?:-(?:mini|nano|pro))?)-\d{4}-\d{2}-\d{2}$/i,
    resolve: (match) => {
      const suffix = match[1] ? match[1].toLowerCase().replace(/^-/, '') : '';
      return { model: suffix ? `gpt-5.4-${suffix}` : 'gpt-5.4' };
    },
  },
  {
    pattern: /^gpt-5\.3-codex-\d{4}-\d{2}-\d{2}$/i,
    resolve: () => ({ model: 'gpt-5.3-codex' }),
  },
  {
    pattern: /^chatgpt-4o(-latest)?$/i,
    resolve: () => ({ model: 'gpt-4o' }),
  },
  {
    pattern: /^chatgpt-4o-mini(-latest)?$/i,
    resolve: () => ({ model: 'gpt-4o-mini' }),
  },
  {
    pattern: /^o1(-preview|-mini|-preview-mini)?$/i,
    resolve: () => ({ model: 'o1' }),
  },
  {
    pattern: /^o3(-mini|-preview)?$/i,
    resolve: (match) => ({ model: match[1] ? `o3${match[1]}` : 'o3' }),
  },
  // Anthropic dated / versioned snapshots
  {
    pattern: /^claude-sonnet-4-6(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-sonnet-4-6' }),
  },
  {
    pattern: /^claude-sonnet-4-5(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-sonnet-4-5' }),
  },
  {
    pattern: /^claude-sonnet-4(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-sonnet-4-20250514' }),
  },
  {
    pattern: /^claude-opus-4-1(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-opus-4-1-20250805' }),
  },
  {
    pattern: /^claude-opus-4-[5-8](-\d{8})?$/i,
    resolve: (match) => {
      const base = match[0]!.split('-').slice(0, 4).join('-').toLowerCase();
      return { model: base };
    },
  },
  {
    pattern: /^claude-opus-4(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-opus-4-20250514' }),
  },
  {
    pattern: /^claude-haiku-4-5(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-haiku-4-5' }),
  },
  {
    pattern: /^claude-3-7-sonnet(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-3-7-sonnet-20250219' }),
  },
  {
    pattern: /^claude-3-5-sonnet(-latest|-\d{8})?$/i,
    resolve: () => ({ model: 'claude-3-5-sonnet-20241022' }),
  },
  {
    pattern: /^claude-3-5-haiku(-\d{8})?$/i,
    resolve: () => ({ model: 'claude-3-5-haiku-20241022' }),
  },
  // Provider-prefixed / platform model IDs
  {
    pattern: /^models\/(.+)$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^publishers\/google\/models\/(.+)$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase(), provider: 'google' }),
  },
  // Gemini preview/exp aliases
  {
    pattern: /^(gemini-2\.5-pro)(-preview.*|-exp.*)?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gemini-2\.5-flash)(-preview.*|-exp.*)?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gemini-2\.5-flash-lite)(-preview.*|-exp.*)?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gemini-2\.0-flash)(-preview.*|-exp.*)?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gemini-3\.1-pro-preview)(-\d{4}-\d{2}-\d{2})?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gemini-3\.1-flash-lite-preview)(-\d{4}-\d{2}-\d{2})?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^(gemini-3\.5-flash)(-preview.*|-exp.*)?$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase() }),
  },
  {
    pattern: /^google\/(gemini[\w.-]+)$/i,
    resolve: (match) => ({ model: match[1]!.toLowerCase(), provider: 'google' }),
  },
  // Qwen aliases
  {
    pattern: /^qwen2\.5(?:-[\w.-]+)?$/i,
    resolve: () => ({ model: 'qwen-plus', provider: 'qwen' }),
  },
  {
    pattern: /^qwen3(?:-[\w.-]+)?$/i,
    resolve: () => ({ model: 'qwen-max', provider: 'qwen' }),
  },
  {
    pattern: /^qwen-(?:max|plus|turbo)(?:-[\w.-]+)?$/i,
    resolve: (match) => {
      const base = match[0]!.split('-').slice(0, 2).join('-').toLowerCase();
      return { model: base, provider: 'qwen' };
    },
  },
  // Moonshot / Kimi aliases
  {
    pattern: /^kimi[-_.\w]*$/i,
    resolve: () => ({ model: 'moonshot-v1-128k', provider: 'moonshot' }),
  },
  {
    pattern: /^moonshot-v1-\d+k$/i,
    resolve: () => ({ model: 'moonshot-v1-128k', provider: 'moonshot' }),
  },
];

function normalizeAliasKey(value: string): string {
  return value.trim().toLowerCase();
}

function resolveAliasEntry(
  entry: ModelAliasEntry,
  provider: PricingProvider,
): { model: string; provider: PricingProvider } {
  if (typeof entry === 'string') {
    return { model: entry, provider };
  }
  return {
    model: entry.target,
    provider: entry.provider ?? provider,
  };
}

/** Strip provider prefixes such as `anthropic/claude-...` or `openrouter/google/gemini-...`. */
export function stripProviderPrefix(model: string): {
  model: string;
  prefixProvider?: PricingProvider;
} {
  let remainder = model.trim();
  let prefixProvider: PricingProvider | undefined;

  if (remainder.toLowerCase().startsWith('openrouter/')) {
    remainder = remainder.slice('openrouter/'.length);
  }

  while (true) {
    const slashIndex = remainder.indexOf('/');
    if (slashIndex <= 0) break;

    const prefix = remainder.slice(0, slashIndex).toLowerCase();
    const mapped = PREFIX_PROVIDERS[prefix];
    if (!mapped) break;

    prefixProvider = mapped;
    remainder = remainder.slice(slashIndex + 1);
  }

  return { model: remainder, prefixProvider };
}

function matchPatternAliases(
  model: string,
  provider: PricingProvider,
): { model: string; provider: PricingProvider } | null {
  for (const rule of PATTERN_ALIASES) {
    const match = model.match(rule.pattern);
    if (!match) continue;
    const resolved = rule.resolve(match, provider);
    if (resolved) {
      return {
        model: resolved.model,
        provider: resolved.provider ?? provider,
      };
    }
  }
  return null;
}

/** Merge user-defined aliases over the bundled defaults. */
export function mergeModelAliases(custom?: ModelAliasMap): ModelAliasMap {
  if (!custom || Object.keys(custom).length === 0) {
    return DEFAULT_MODEL_ALIASES;
  }

  const merged: ModelAliasMap = { ...DEFAULT_MODEL_ALIASES };
  for (const [key, value] of Object.entries(custom)) {
    merged[normalizeAliasKey(key)] = value;
  }
  return merged;
}

/** Resolve a raw session model name to a canonical pricing-table model id. */
export function resolveModelAlias(
  rawModel: string,
  provider: PricingProvider,
  aliases: ModelAliasMap = DEFAULT_MODEL_ALIASES,
): ResolvedModelAlias {
  const stripped = stripProviderPrefix(rawModel);
  let model = stripped.model.trim();
  let resolvedProvider = stripped.prefixProvider ?? provider;

  const direct =
    aliases[normalizeAliasKey(model)] ?? aliases[normalizeAliasKey(rawModel)];
  if (direct) {
    const resolved = resolveAliasEntry(direct, resolvedProvider);
    return { ...resolved, aliasUsed: rawModel };
  }

  const patternMatch = matchPatternAliases(model, resolvedProvider);
  if (patternMatch) {
    return { ...patternMatch, aliasUsed: rawModel };
  }

  return { model, provider: resolvedProvider };
}
