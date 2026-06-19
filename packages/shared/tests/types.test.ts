import { describe, it, expect } from 'vitest';
import { normalizeTokenTotals, totalsFromMessages, computeTotalTokens } from '../src/utils.js';

describe('token totals helpers', () => {
  it('maps legacy cachedInputTokens to cacheReadTokens', () => {
    const totals = normalizeTokenTotals({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 25,
      reasoningTokens: 0,
    });
    expect(totals.cacheReadTokens).toBe(25);
    expect(totals.cachedInputTokens).toBe(25);
    expect(totals.totalTokens).toBe(computeTotalTokens(totals));
  });

  it('aggregates expanded message token fields', () => {
    const totals = totalsFromMessages([
      {
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationTokens: 2,
        cacheReadTokens: 3,
      },
      { inputTokens: 1, outputTokens: 1, toolTokens: 4 },
    ]);
    expect(totals.cacheCreationTokens).toBe(2);
    expect(totals.cacheReadTokens).toBe(3);
    expect(totals.toolTokens).toBe(4);
    expect(totals.totalTokens).toBe(10 + 5 + 2 + 3 + 1 + 1 + 4);
  });
});
