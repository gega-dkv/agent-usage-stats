import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { grokParser } from '../src/grok.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceFixture = path.join(__dirname, 'fixtures', 'grok', 'signals.json');

/**
 * Copy the fixture to a temp path under a `.grok/sessions` tree with a fresh
 * mtime, so the 30-day lookback window never rejects it.
 */
function freshFixture(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-test-'));
  const dir = path.join(tmp, '.grok', 'sessions', 'sig-1');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'signals.json');
  fs.copyFileSync(sourceFixture, dest);
  const now = new Date();
  fs.utimesSync(dest, now, now);
  return dest;
}

describe('Grok parser', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = freshFixture();
  });

  it('detects signals.json files under a .grok tree', () => {
    const sample = fs.readFileSync(filePath, 'utf-8');
    expect(grokParser.canParse(filePath, sample)).toBe(true);
  });

  it('aggregates totalTokensBeforeCompaction + contextTokensUsed', async () => {
    const result = await grokParser.parse(filePath);

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.provider).toBe('grok');
    expect(session.messages).toHaveLength(1);

    const msg = session.messages[0];
    // 120000 + 45000 = 165000 aggregate tokens, no input/output split.
    expect(msg.inputTokens).toBe(165000);
    expect(msg.outputTokens).toBeUndefined();
    expect(msg.metadata?.totalTokensBeforeCompaction).toBe(120000);
    expect(msg.metadata?.contextTokensUsed).toBe(45000);

    // Session totals flow from the aggregate input tokens.
    expect(session.totals.inputTokens).toBe(165000);
    expect(session.totals.totalTokens).toBe(165000);

    // Tokens-only provider: no cost, metadata-level confidence.
    expect(session.supportLevel).toBe('prompt-history-only');
    expect(session.usageConfidence).toBe('metadata-only');
    expect(session.tokenUsageEstimated).toBe(true);
  });

  it('ranks models by frequency and exposes the primary model', async () => {
    const result = await grokParser.parse(filePath);
    const msg = result.sessions[0].messages[0];

    // primaryModelId (grok-3) + modelsUsed (grok-3 x2, grok-3-mini) => grok-3 first.
    expect(msg.model).toBe('grok-3');
    expect(msg.metadata?.primaryModelId).toBe('grok-3');
    expect(msg.metadata?.modelsUsed).toEqual(['grok-3', 'grok-3-mini']);
  });

  it('skips signals.json files older than the 30-day lookback window', async () => {
    // Force the mtime well outside the window.
    const stale = new Date();
    stale.setDate(stale.getDate() - 60);
    fs.utimesSync(filePath, stale, stale);

    const result = await grokParser.parse(filePath);
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'detected-only')).toBe(true);
  });
});
