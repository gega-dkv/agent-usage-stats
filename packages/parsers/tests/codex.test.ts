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

  it('parses token_count events into session totals', async () => {
    const result = await codexParser.parse(fixture('events-valid'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.provider).toBe('codex');
    expect(session.id).toBe('codex-events-session-1');
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].model).toBe('gpt-5.5');

    // Cost-relevant fields: non-cached input = 250 - 50, cached = 50, output = 80
    expect(session.totals.inputTokens).toBe(200);
    expect(session.totals.cachedInputTokens).toBe(50);
    expect(session.totals.outputTokens).toBe(80);
    // Detailed provider-only fields
    expect(session.totals.reasoningTokens).toBe(10);
    // Codex-reported authoritative total
    expect(session.totals.totalTokens).toBe(330);

    expect(session.usageConfidence).toBe('exact');
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
});
