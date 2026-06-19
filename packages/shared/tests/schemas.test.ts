import { describe, it, expect } from 'vitest';
import {
  appConfigSchema,
  parseAppConfig,
  providerSchema,
  pricingProviderSchema,
  listProviderIds,
} from '../src/index.js';

describe('Config schemas', () => {
  it('accepts all registered provider ids', () => {
    for (const id of listProviderIds()) {
      expect(providerSchema.safeParse(id).success).toBe(true);
    }
  });

  it('parses a minimal config with defaults', () => {
    const config = parseAppConfig({});
    expect(config.privacyMode).toBe('disabled');
    expect(config.storeRawRecords).toBe(false);
    expect(config.estimatePromptOnlySources).toBe(false);
  });

  it('parses per-provider overrides', () => {
    const config = parseAppConfig({
      providers: {
        claude: { enabled: false, paths: ['/custom/claude'] },
        opencode: { enabled: true, paths: [] },
      },
      resimulateRecordedCosts: true,
    });
    expect(config.providers.claude?.enabled).toBe(false);
    expect(config.providers.claude?.paths).toEqual(['/custom/claude']);
    expect(config.providers.opencode?.enabled).toBe(true);
    expect(config.resimulateRecordedCosts).toBe(true);
  });

  it('rejects unknown providers', () => {
    const result = appConfigSchema.safeParse({
      providers: { 'not-a-provider': { enabled: true, paths: [] } },
    });
    expect(result.success).toBe(false);
  });

  it('accepts extended pricing providers', () => {
    expect(pricingProviderSchema.safeParse('qwen').success).toBe(true);
    expect(pricingProviderSchema.safeParse('moonshot').success).toBe(true);
    expect(pricingProviderSchema.safeParse('other').success).toBe(true);
  });
});
