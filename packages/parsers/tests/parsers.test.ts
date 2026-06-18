import { describe, it, expect } from 'vitest';
import { claudeParser } from '../src/claude.js';
import { geminiParser } from '../src/gemini.js';
import { codexParser } from '../src/codex.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

describe('Claude Parser', () => {
  it('should detect Claude JSONL files', () => {
    const sample = `{"uuid":"msg-1","type":"message","role":"user","content":"test"}`;
    expect(claudeParser.canParse('/path/to/.claude/projects/test.jsonl', sample)).toBe(true);
  });

  it('should reject non-JSONL files', () => {
    const sample = `{"uuid":"msg-1","type":"message","role":"user"}`;
    expect(claudeParser.canParse('/path/to/file.json', sample)).toBe(false);
  });

  it('should parse Claude session files', async () => {
    const filePath = path.join(fixturesDir, 'claude-session.jsonl');
    const result = await claudeParser.parse(filePath);

    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.sessions[0].provider).toBe('claude');
    expect(result.sessions[0].messages.length).toBeGreaterThan(0);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
  });

  it('should handle empty files gracefully', async () => {
    const result = await claudeParser.parse('/nonexistent/file.jsonl');
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('Gemini Parser', () => {
  it('should detect Gemini chat files', () => {
    const sample = `{"chatId":"test","messages":[]}`;
    expect(geminiParser.canParse('/path/to/.gemini/tmp/chats/test.json', sample)).toBe(true);
  });

  it('should parse Gemini chat files', async () => {
    const filePath = path.join(fixturesDir, 'gemini-chat.json');
    const result = await geminiParser.parse(filePath);

    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].provider).toBe('gemini');
    expect(result.sessions[0].messages.length).toBe(4);
  });

  it('should extract token usage from Gemini files', async () => {
    const filePath = path.join(fixturesDir, 'gemini-chat.json');
    const result = await geminiParser.parse(filePath);

    const session = result.sessions[0];
    expect(session.totals.inputTokens).toBeGreaterThan(0);
    expect(session.totals.outputTokens).toBeGreaterThan(0);
  });
});

describe('Codex Parser', () => {
  it('should detect Codex session files', () => {
    const sample = `{"role":"user","content":"test"}`;
    expect(codexParser.canParse('/path/to/.codex/session.json', sample)).toBe(true);
  });

  it('should parse Codex session files', async () => {
    const filePath = path.join(fixturesDir, 'codex-session.json');
    const result = await codexParser.parse(filePath);

    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].provider).toBe('codex');
    expect(result.sessions[0].messages.length).toBe(4);
  });

  it('should extract token usage from Codex files', async () => {
    const filePath = path.join(fixturesDir, 'codex-session.json');
    const result = await codexParser.parse(filePath);

    const session = result.sessions[0];
    expect(session.totals.inputTokens).toBeGreaterThan(0);
    expect(session.totals.outputTokens).toBeGreaterThan(0);
  });
});
