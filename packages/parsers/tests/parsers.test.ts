import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import { claudeParser } from '../src/claude.js';
import { geminiParser } from '../src/gemini.js';
import { codexParser } from '../src/codex.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function fixture(provider: string, name: string) {
  const ext = provider === 'gemini' ? 'json' : 'jsonl';
  return path.join(fixturesDir, provider, `${name}.${ext}`);
}

describe('Claude Parser', () => {
  it('should detect Claude JSONL files', () => {
    const sample = `{"uuid":"msg-1","type":"message","role":"user","content":"test"}`;
    expect(claudeParser.canParse('/path/to/.claude/projects/test.jsonl', sample)).toBe(true);
  });

  it('should reject non-JSONL files', () => {
    const sample = `{"uuid":"msg-1","type":"message","role":"user"}`;
    expect(claudeParser.canParse('/path/to/file.json', sample)).toBe(false);
  });

  it('should parse valid Claude session files', async () => {
    const result = await claudeParser.parse(fixture('claude', 'valid'));

    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.sessions[0].provider).toBe('claude');
    expect(result.sessions[0].messages.length).toBeGreaterThan(0);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
  });

  it('should parse legacy top-level fixture', async () => {
    const filePath = path.join(fixturesDir, 'claude-session.jsonl');
    const result = await claudeParser.parse(filePath);
    expect(result.sessions.length).toBeGreaterThan(0);
  });

  it('should parse missing-fields files without crashing', async () => {
    const result = await claudeParser.parse(fixture('claude', 'missing-fields'));
    expect(result.sessions.length).toBe(1);
    // No structured usage — parser may estimate from text content
    expect(result.sessions[0].messages.length).toBe(2);
  });

  it('should warn on corrupt lines but keep valid records', async () => {
    const result = await claudeParser.parse(fixture('claude', 'corrupt'));
    expect(result.sessions.length).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.sessions[0].messages.length).toBeGreaterThan(0);
  });

  it('should parse multiple sessions from one JSONL file', async () => {
    const result = await claudeParser.parse(fixture('claude', 'multi-session'));
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((s) => s.id).sort()).toEqual(['session-a', 'session-b']);
  });

  it('streams JSONL line-by-line without loading the full file into memory', async () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    try {
      await claudeParser.parse(fixture('claude', 'valid'));
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
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

  it('should parse valid Gemini chat files', async () => {
    const result = await geminiParser.parse(fixture('gemini', 'valid'));

    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].provider).toBe('gemini');
    expect(result.sessions[0].messages.length).toBe(4);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
    expect(result.sessions[0].totals.outputTokens).toBeGreaterThan(0);
  });

  it('should parse legacy top-level fixture', async () => {
    const filePath = path.join(fixturesDir, 'gemini-chat.json');
    const result = await geminiParser.parse(filePath);
    expect(result.sessions.length).toBe(1);
  });

  it('should parse missing-fields files without crashing', async () => {
    const result = await geminiParser.parse(fixture('gemini', 'missing-fields'));
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].messages.length).toBe(2);
  });

  it('should handle corrupt JSON without crashing', async () => {
    const result = await geminiParser.parse(fixture('gemini', 'corrupt'));
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('Codex Parser', () => {
  it('should detect Codex session files', () => {
    const sample = `{"role":"user","content":"test"}`;
    expect(codexParser.canParse('/path/to/.codex/session.json', sample)).toBe(true);
  });

  it('should parse valid Codex session files', async () => {
    const result = await codexParser.parse(fixture('codex', 'valid'));

    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].provider).toBe('codex');
    expect(result.sessions[0].messages.length).toBe(4);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
    expect(result.sessions[0].totals.outputTokens).toBeGreaterThan(0);
  });

  it('should parse legacy top-level fixture', async () => {
    const filePath = path.join(fixturesDir, 'codex-session.json');
    const result = await codexParser.parse(filePath);
    expect(result.sessions.length).toBe(1);
  });

  it('should parse missing-fields files without crashing', async () => {
    const result = await codexParser.parse(fixture('codex', 'missing-fields'));
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].messages.length).toBe(2);
  });

  it('should warn on corrupt lines but keep valid records', async () => {
    const result = await codexParser.parse(fixture('codex', 'corrupt'));
    expect(result.sessions.length).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('streams JSONL without reading the full file for format detection', async () => {
    const readSpy = vi.spyOn(fs, 'readFileSync');
    try {
      await codexParser.parse(fixture('codex', 'valid'));
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      readSpy.mockRestore();
    }
  });
});
