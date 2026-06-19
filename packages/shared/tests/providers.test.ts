import { describe, it, expect } from 'vitest';
import {
  PROVIDER_REGISTRY,
  listProviders,
  listProviderIds,
  getProviderDefinition,
  isKnownProvider,
  providersWithParser,
  providerToPricingProvider,
} from '../src/index.js';

describe('Provider registry', () => {
  it('registers the three first-class providers with parsers', () => {
    const withParser = providersWithParser();
    expect(withParser).toContain('claude');
    expect(withParser).toContain('codex');
    expect(withParser).toContain('gemini');
  });

  it('exposes every registry entry through listProviders', () => {
    const ids = listProviderIds();
    expect(ids.length).toBe(Object.keys(PROVIDER_REGISTRY).length);
    expect(listProviders().every((p) => ids.includes(p.id))).toBe(true);
  });

  it('keeps each definition internally consistent', () => {
    for (const def of listProviders()) {
      expect(def.id).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.pricingProvider).toBeTruthy();
      expect(Array.isArray(def.defaultPaths)).toBe(true);
      // detect-only / unsupported providers must not claim to have a parser.
      if (def.supportLevel === 'detected-only' || def.supportLevel === 'unsupported') {
        expect(def.hasParser).toBe(false);
      }
    }
  });

  it('identifies known vs unknown providers', () => {
    expect(isKnownProvider('claude')).toBe(true);
    expect(isKnownProvider('opencode')).toBe(true);
    expect(isKnownProvider('totally-made-up')).toBe(false);
  });

  it('derives the pricing provider from the registry', () => {
    expect(providerToPricingProvider('claude')).toBe('anthropic');
    expect(providerToPricingProvider('codex')).toBe('openai');
    expect(providerToPricingProvider('gemini')).toBe('google');
    expect(providerToPricingProvider('kimi')).toBe('moonshot');
  });

  it('returns undefined for an unregistered definition lookup', () => {
    expect(getProviderDefinition('nope')).toBeUndefined();
  });
});
