import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, type AppDatabase, purgeContent } from '@agent-usage/db';
import { scanSessions, getDefaultConfig } from '@agent-usage/core';
import { aiderParser } from '@agent-usage/parsers';
import { cursorParser } from '@agent-usage/parsers';
import { specstoryParser } from '@agent-usage/parsers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const claudeFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/claude/valid.jsonl',
);
const aiderMissingFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/aider/missing-fields.aider.chat.history.md',
);
const cursorMdFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/cursor/valid.md',
);
const specstoryFixture = path.join(
  __dirname,
  '../../parsers/tests/fixtures/specstory/history/valid.md',
);

function messageRows(database: AppDatabase) {
  return database.sqlite
    .prepare(
      'SELECT content_text, content_preview, raw, tool_input_preview, tool_output_preview, message_metadata FROM messages',
    )
    .all() as Array<{
    content_text: string | null;
    content_preview: string;
    raw: string | null;
    tool_input_preview: string | null;
    tool_output_preview: string | null;
    message_metadata: string | null;
  }>;
}

describe('privacy mode integration', () => {
  let dbPath: string;
  let database: AppDatabase;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `aus-privacy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    database = initializeDatabase(dbPath);
  });

  afterEach(() => {
    database.sqlite.close();
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + suffix);
      } catch {
        /* ignore */
      }
    }
  });

  it('default disabled mode stores token metadata but no prompt content', async () => {
    const config = getDefaultConfig();
    expect(config.privacyMode).toBe('disabled');

    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const rows = messageRows(database);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.content_text).toBeNull();
      expect(row.content_preview).toMatch(/^\[(user|assistant|system|tool|unknown) message\]$/);
      expect(row.raw).toBeNull();
      expect(row.tool_input_preview).toBeNull();
      expect(row.tool_output_preview).toBeNull();
    }

    const session = database.sqlite
      .prepare('SELECT total_tokens FROM sessions LIMIT 1')
      .get() as { total_tokens: number };
    expect(session.total_tokens).toBeGreaterThan(0);
  });

  it('preview mode stores truncated previews without full text', async () => {
    const config = { ...getDefaultConfig(), privacyMode: 'preview' as const };
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const rows = messageRows(database);
    expect(rows.some((r) => r.content_preview.length > 10 && !r.content_preview.startsWith('[purged]'))).toBe(
      true,
    );
    expect(rows.every((r) => r.content_text == null)).toBe(true);
    expect(rows.every((r) => r.raw == null)).toBe(true);
  });

  it('full mode stores content text but not raw unless storeRawRecords is enabled', async () => {
    const config = { ...getDefaultConfig(), privacyMode: 'full' as const };
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const rows = messageRows(database);
    expect(rows.some((r) => r.content_text != null && r.content_text.length > 0)).toBe(true);
    expect(rows.every((r) => r.raw == null)).toBe(true);
  });

  it('raw privacy mode or storeRawRecords persists provider-native raw payloads', async () => {
    const config = { ...getDefaultConfig(), privacyMode: 'raw' as const };
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const rawRows = messageRows(database).filter((r) => r.raw != null);
    expect(rawRows.length).toBeGreaterThan(0);
  });

  it('purge-content removes stored prompt, response, raw, and tool previews', async () => {
    const config = { ...getDefaultConfig(), privacyMode: 'full' as const, storeRawRecords: true };
    await scanSessions(database, config, {
      paths: [claudeFixture],
      provider: 'claude',
      force: true,
    });

    const before = messageRows(database);
    expect(before.some((r) => r.content_text != null)).toBe(true);

    const purged = purgeContent(database.sqlite);
    expect(purged.messages).toBeGreaterThanOrEqual(1);

    const after = messageRows(database);
    for (const row of after) {
      expect(row.content_text).toBeNull();
      expect(row.content_preview).toBe('[purged]');
      expect(row.raw).toBeNull();
      expect(row.tool_input_preview).toBeNull();
      expect(row.tool_output_preview).toBeNull();
      expect(row.message_metadata).toBeNull();
    }
  });
});

describe('prompt-only estimation', () => {
  const disabledPrivacy = { privacyMode: 'disabled' as const, estimatePromptOnlySources: false };

  it('aider does not invent tokens when estimation is disabled', async () => {
    const result = await aiderParser.parse(aiderMissingFixture, disabledPrivacy);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messages.every((m) => !m.inputTokens && !m.outputTokens)).toBe(true);
    expect(result.sessions[0].messages.every((m) => !m.contentText)).toBe(true);
  });

  it('cursor markdown does not invent tokens when estimation is disabled', async () => {
    const result = await cursorParser.parse(cursorMdFixture, disabledPrivacy);
    expect(result.sessions).toHaveLength(1);
    const msg = result.sessions[0].messages[0];
    expect(msg.inputTokens).toBeUndefined();
    expect(msg.outputTokens).toBeUndefined();
    expect(msg.contentText).toBeUndefined();
    expect(msg.contentPreview).toBe('[user message]');
  });

  it('specstory does not invent tokens when estimation is disabled', async () => {
    const result = await specstoryParser.parse(specstoryFixture, disabledPrivacy);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messages.every((m) => !m.inputTokens && !m.outputTokens)).toBe(true);
    expect(result.sessions[0].usageConfidence).not.toBe('estimated-from-text');
  });

  it('aider estimates tokens only when estimatePromptOnlySources is enabled', async () => {
    const result = await aiderParser.parse(aiderMissingFixture, {
      ...disabledPrivacy,
      estimatePromptOnlySources: true,
    });
    expect(result.sessions[0].messages.some((m) => (m.inputTokens || 0) > 0)).toBe(true);
    expect(result.sessions[0].messages.some((m) => m.usageConfidence === 'estimated-from-text')).toBe(
      true,
    );
  });
});
