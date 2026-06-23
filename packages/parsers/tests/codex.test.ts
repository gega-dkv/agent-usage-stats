import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { codexParser } from '../src/codex.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'codex');

function fixture(name: string) {
  return path.join(fixturesDir, `${name}.jsonl`);
}

describe('Codex event-format parser', () => {
  it('detects real Codex event JSONL files', () => {
    const sample = `{"timestamp":"2026-06-06T00:00:00.000Z","type":"session_meta","payload":{"id":"s1"}}`;
    expect(codexParser.canParse('/path/to/.codex/sessions/2026/06/06/rollout.jsonl', sample)).toBe(true);
  });

  it('parses token_count events into per-turn usage messages', async () => {
    const result = await codexParser.parse(fixture('events-valid'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.provider).toBe('codex');
    expect(session.id).toBe('codex-events-session-1');
    // One assistant usage message per token_count event (2 turns).
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].model).toBe('gpt-5.5');
    expect(session.messages[1].model).toBe('gpt-5.5');

    // Turn 1 (first prompt): last_token_usage = 120/20/30/5.
    expect(session.messages[0].inputTokens).toBe(120 - 20); // non-cached input
    expect(session.messages[0].cachedInputTokens).toBe(20);
    expect(session.messages[0].outputTokens).toBe(30);
    expect(session.messages[0].reasoningTokens).toBe(5);
    // Turn 2: last_token_usage delta = 130/30/50/5.
    expect(session.messages[1].inputTokens).toBe(130 - 30);
    expect(session.messages[1].cachedInputTokens).toBe(30);
    expect(session.messages[1].outputTokens).toBe(50);
    expect(session.messages[1].reasoningTokens).toBe(5);

    // Session totals reflect both turns: non-cached input = 250 - 50, cached = 50, output = 80
    expect(session.totals.inputTokens).toBe(200);
    expect(session.totals.cachedInputTokens).toBe(50);
    expect(session.totals.outputTokens).toBe(80);
    // Detailed provider-only fields
    expect(session.totals.reasoningTokens).toBe(10);
    // Codex-reported authoritative total
    expect(session.totals.totalTokens).toBe(330);

    expect(session.usageConfidence).toBe('cumulative-delta');
    expect(session.supportLevel).toBe('exact-usage');
    expect(session.tokenUsageEstimated).toBe(false);
  });

  it('warns when no token_count events are present', async () => {
    const result = await codexParser.parse(fixture('events-missing-tokens'));

    expect(result.sessions).toHaveLength(1);
    expect(result.warnings.some((w) => w.code === 'missing-token-fields')).toBe(true);
    expect(result.sessions[0].totals.inputTokens).toBe(0);
    expect(result.sessions[0].tokenUsageEstimated).toBe(true);
  });

  it('warns on corrupt event lines but keeps valid records', async () => {
    const result = await codexParser.parse(fixture('events-corrupt'));

    expect(result.sessions).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.sessions[0].totals.totalTokens).toBe(150);
  });

  it('streams event JSONL without loading the full file into memory', async () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    try {
      await codexParser.parse(fixture('events-valid'));
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });

  it('attributes per-turn deltas across days and models', async () => {
    const result = await codexParser.parse(fixture('events-multi-day'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.messages).toHaveLength(2);
    // Each turn keeps its own model + timestamp even though the session spans days.
    expect(session.messages[0].model).toBe('gpt-5.5');
    expect(session.messages[0].timestamp).toBe('2026-06-06T00:00:04.000Z');
    expect(session.messages[1].model).toBe('gpt-5.4');
    expect(session.messages[1].timestamp).toBe('2026-06-07T00:00:04.000Z');

    // Turn 1: 100/20/40/5 (non-cached input = 80).
    expect(session.messages[0].inputTokens).toBe(80);
    expect(session.messages[0].cachedInputTokens).toBe(20);
    expect(session.messages[0].outputTokens).toBe(40);
    // Turn 2 last-delta: 200/30/80/3 (non-cached input = 170).
    expect(session.messages[1].inputTokens).toBe(170);
    expect(session.messages[1].cachedInputTokens).toBe(30);
    expect(session.messages[1].outputTokens).toBe(80);

    // Session totals: non-cached input = (100+200) - (20+30) = 250.
    expect(session.totals.inputTokens).toBe(250);
    expect(session.totals.cachedInputTokens).toBe(50);
    expect(session.totals.outputTokens).toBe(120);
    // Authoritative grand total from the final token_count.
    expect(session.totals.totalTokens).toBe(430);
  });

  it('inherits parent totals for forked sessions so they are not double-counted', async () => {
    const result = await codexParser.parse(fixture('events-fork'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.id).toBe('codex-fork-child');
    expect(session.messages).toHaveLength(1);

    // The parent already spent 500/100/200. This child's only turn added
    // 100/20/60 (total-delta == last-delta here), NOT the full 600/120/260.
    expect(session.messages[0].inputTokens).toBe(100 - 20);
    expect(session.messages[0].cachedInputTokens).toBe(20);
    expect(session.messages[0].outputTokens).toBe(60);
    expect(session.messages[0].reasoningTokens).toBe(10);

    expect(session.totals.inputTokens).toBe(80);
    expect(session.totals.cachedInputTokens).toBe(20);
    expect(session.totals.outputTokens).toBe(60);
    // The authoritative grand total is the full cumulative 870, regardless of
    // how much was inherited — that total reflects the whole session lifetime.
    expect(session.totals.totalTokens).toBe(870);
  });
});
