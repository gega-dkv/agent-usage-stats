import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { claudeParser } from '../src/claude.js';
import { codexParser } from '../src/codex.js';
import { geminiParser } from '../src/gemini.js';
import { qwenParser } from '../src/qwen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function fixture(provider: string, name: string, ext?: string): string {
  const extension = ext ?? (provider === 'gemini' ? 'json' : 'jsonl');
  return path.join(fixturesDir, provider, `${name}.${extension}`);
}

describe('parser robustness', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aus-parser-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles corrupt JSONL without throwing (Claude, Codex, Qwen)', async () => {
    for (const [parser, provider] of [
      [claudeParser, 'claude'],
      [codexParser, 'codex'],
      [qwenParser, 'qwen'],
    ] as const) {
      const result = await parser.parse(fixture(provider, 'corrupt'));
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(Array.isArray(result.sessions)).toBe(true);
    }
  });

  it('handles corrupt JSON without throwing (Gemini)', async () => {
    const result = await geminiParser.parse(fixture('gemini', 'corrupt'));
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('skips unknown record types and still returns sessions', async () => {
    const file = path.join(tmpDir, 'unknown-records.jsonl');
    fs.writeFileSync(
      file,
      [
        JSON.stringify({ type: 'queue-operation', uuid: 'q1' }),
        JSON.stringify({
          type: 'message',
          uuid: 'm1',
          sessionId: 'robust-session',
          role: 'user',
          content: 'hello',
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
        JSON.stringify({ type: 'file-history-snapshot', uuid: 'f1' }),
      ].join('\n'),
    );

    const result = await claudeParser.parse(file);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messages.length).toBeGreaterThanOrEqual(1);
  });

  it('parses sessions when usage fields are missing', async () => {
    const claude = await claudeParser.parse(fixture('claude', 'missing-fields'));
    expect(claude.sessions).toHaveLength(1);
    expect(claude.sessions[0].messages.length).toBeGreaterThan(0);

    const gemini = await geminiParser.parse(fixture('gemini', 'missing-fields'));
    expect(gemini.sessions).toHaveLength(1);
  });

  it('deduplicates sessions by id within one file', async () => {
    const result = await claudeParser.parse(fixture('claude', 'multi-session'));
    const ids = result.sessions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['session-a', 'session-b']);
  });

  it('streams large JSONL files line-by-line', async () => {
    const file = path.join(tmpDir, 'large.jsonl');
    const lines: string[] = [];
    for (let i = 0; i < 500; i++) {
      lines.push(
        JSON.stringify({
          type: 'message',
          uuid: `msg-${i}`,
          sessionId: 'large-session',
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `message ${i}`,
          usage: { input_tokens: i % 2 === 0 ? 5 : 0, output_tokens: i % 2 === 1 ? 3 : 0 },
        }),
      );
    }
    fs.writeFileSync(file, lines.join('\n'));

    const result = await claudeParser.parse(file);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messages.length).toBe(500);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
  });

  it('returns warnings for missing files instead of throwing', async () => {
    const result = await codexParser.parse(path.join(tmpDir, 'does-not-exist.jsonl'));
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
