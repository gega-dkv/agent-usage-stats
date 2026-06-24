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

  it('should detect sessions whose sample holds only metadata rows', () => {
    // Real sessions often open with metadata rows (last-prompt, mode, queue
    // operations); the first user/assistant message can sit past the ~4 KB
    // content sample. Detection must not depend on a conversation row appearing.
    const sample = [
      `{"type":"last-prompt","leafUuid":"x","sessionId":"s1"}`,
      `{"type":"mode","mode":"default","sessionId":"s1"}`,
      `{"type":"permission-mode","permissionMode":"default","sessionId":"s1"}`,
    ].join('\n');
    expect(claudeParser.canParse('/tmp/relocated/s1.jsonl', sample)).toBe(true);
  });

  it('should detect Claude session files by path when the sample is truncated', () => {
    // A huge first record (e.g. a sidechain prompt) can exceed the sample, so
    // the sample is a single unparseable fragment. The `.claude/projects/` path
    // is the reliable fallback so these sessions are not silently dropped.
    const truncated = `{"type":"user","message":{"role":"user","content":"${'x'.repeat(50)}`;
    expect(
      claudeParser.canParse('/Users/me/.claude/projects/proj/agent-abc.jsonl', truncated),
    ).toBe(true);
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

  it('collapses cumulative streaming chunks into the final assistant turn', async () => {
    const result = await claudeParser.parse(fixture('claude', 'streaming-dedup'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    // Two user turns + two assistant turns (3 chunks of the first assistant
    // message collapse to one). No fabricated/estimated rows.
    const assistants = session.messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(2);

    // Final cumulative chunk wins: input 1000, cache_create 200, cache_read 300, output 500
    const first = assistants[0];
    expect(first.id).toBe('msg_01ABCDEF');
    expect(first.inputTokens).toBe(1000);
    expect(first.cacheCreationTokens).toBe(200);
    expect(first.cacheReadTokens).toBe(300);
    expect(first.outputTokens).toBe(500);

    // Session totals must reflect the deduped values, not the sum of every chunk.
    expect(session.totals.inputTokens).toBe(1000 + 2000);
    expect(session.totals.cacheCreationTokens).toBe(200);
    expect(session.totals.cacheReadTokens).toBe(300 + 800);
    expect(session.totals.outputTokens).toBe(500 + 75);
    // 3 chunks + 1 second assistant + 2 user messages = 4 stored messages.
    expect(session.messages).toHaveLength(4);
  });

  it('parses the nested message.* Claude Code format and flags Vertex rows', async () => {
    const result = await claudeParser.parse(fixture('claude', 'nested-format'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    const assistants = session.messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(2);

    // Model is read from the nested message.model, not the record top level.
    expect(assistants[0].model).toBe('claude-sonnet-4-5');
    expect(assistants[1].model).toBe('claude-3-5-sonnet@20240620');

    // The @-suffixed model marks the second row as Vertex-served.
    expect(assistants[0].metadata).toBeUndefined();
    expect(assistants[1].metadata?.vertex).toBe(true);

    expect(session.totals.inputTokens).toBe(1500 + 1200);
    expect(session.totals.outputTokens).toBe(300 + 120);
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
