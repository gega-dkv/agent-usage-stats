import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import * as providerSqlite from '../src/provider-sqlite.js';
import { qwenParser } from '../src/qwen.js';
import { openclawParser } from '../src/openclaw.js';
import { kimiParser } from '../src/kimi.js';
import { ampParser } from '../src/amp.js';
import { droidParser } from '../src/droid.js';
import { codebuffParser } from '../src/codebuff.js';
import { piAgentParser } from '../src/pi-agent.js';
import { aiderParser } from '../src/aider.js';
import { specstoryParser } from '../src/specstory.js';
import { copilotParser } from '../src/copilot.js';
import { opencodeParser } from '../src/opencode.js';
import { gooseParser } from '../src/goose.js';
import { hermesParser } from '../src/hermes.js';
import { kiloParser } from '../src/kilo.js';
import { cursorParser } from '../src/cursor.js';
import { crushParser } from '../src/crush.js';
import type { ProviderParser } from '@agent-usage/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function fixture(provider: string, name: string, ext?: string): string {
  const dir = path.join(fixturesDir, provider);
  if (ext) return path.join(dir, `${name}.${ext}`);
  if (provider === 'droid') return path.join(dir, `${name}.settings.json`);
  if (provider === 'aider') return path.join(dir, `${name}.aider.chat.history.md`);
  if (provider === 'specstory') return path.join(dir, 'history', `${name}.md`);
  if (provider === 'opencode' && name.startsWith('legacy')) {
    return path.join(dir, 'legacy-json', `${name.replace('legacy-', '')}.json`);
  }
  if (['goose', 'hermes', 'kilo', 'cursor', 'opencode'].includes(provider) && !ext) {
    if (provider === 'opencode') return path.join(dir, 'sqlite', `${name}.db`);
    return path.join(dir, `${name}.db`);
  }
  const jsonlProviders = ['qwen', 'openclaw', 'kimi', 'copilot', 'pi-agent'];
  const extension = ext || (jsonlProviders.includes(provider) ? 'jsonl' : 'json');
  return path.join(dir, `${name}.${extension}`);
}

async function parseFixture(parser: ProviderParser, provider: string, name: string, ext?: string) {
  const file = fixture(provider, name, ext);
  return parser.parse(file);
}

describe('Phase 2 provider parsers', () => {
  it('qwen parses valid/missing/corrupt fixtures', async () => {
    const valid = await parseFixture(qwenParser, 'qwen', 'valid');
    expect(valid.sessions).toHaveLength(1);
    expect(valid.sessions[0].totals.inputTokens).toBeGreaterThan(0);

    const missing = await parseFixture(qwenParser, 'qwen', 'missing-fields');
    expect(missing.sessions).toHaveLength(1);

    const corrupt = await parseFixture(qwenParser, 'qwen', 'corrupt');
    expect(corrupt.warnings.length).toBeGreaterThan(0);
    expect(corrupt.sessions).toHaveLength(1);
  });

  it('openclaw parses valid fixtures with recorded cost', async () => {
    const result = await parseFixture(openclawParser, 'openclaw', 'valid');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].costs?.recordedCost).toBeGreaterThan(0);
  });

  it('kimi parses StatusUpdate token usage', async () => {
    const result = await parseFixture(kimiParser, 'kimi', 'valid');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messages[0].model).toBe('kimi-for-coding');
  });

  it('amp parses thread usage', async () => {
    const result = await parseFixture(ampParser, 'amp', 'valid');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
  });

  it('factory droid parses settings usage', async () => {
    const result = await parseFixture(droidParser, 'droid', 'valid');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].totals.reasoningTokens).toBeGreaterThan(0);
  });

  it('codebuff parses nested metadata usage', async () => {
    const result = await parseFixture(codebuffParser, 'codebuff', 'valid');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].totals.outputTokens).toBeGreaterThan(0);
  });

  it('pi-agent parses jsonl and json fixtures', async () => {
    const jsonl = await parseFixture(piAgentParser, 'pi-agent', 'valid');
    expect(jsonl.sessions).toHaveLength(1);
    const json = await piAgentParser.parse(fixture('pi-agent', 'valid', 'json'));
    expect(json.sessions).toHaveLength(1);
  });

  it('aider does not invent tokens unless estimation enabled', async () => {
    const missing = await parseFixture(aiderParser, 'aider', 'missing-fields');
    expect(missing.sessions[0].messages.every((m) => !m.inputTokens && !m.outputTokens)).toBe(true);

    const estimated = await aiderParser.parse(fixture('aider', 'missing-fields'), {
      privacyMode: 'preview',
      estimatePromptOnlySources: true,
      providers: { claude: { enabled: true, paths: [] }, codex: { enabled: true, paths: [] }, gemini: { enabled: true, paths: [] } },
      customPaths: [],
      currency: 'USD',
      storeRawRecords: false,
    });
    expect(estimated.sessions[0].messages.some((m) => (m.inputTokens || 0) > 0)).toBe(true);
  });

  it('specstory parses markdown history', async () => {
    const result = await parseFixture(specstoryParser, 'specstory', 'valid');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].messages.length).toBeGreaterThanOrEqual(2);
  });

  it('copilot parses OpenTelemetry spans', async () => {
    const result = await parseFixture(copilotParser, 'copilot', 'valid');
    expect(result.sessions.length).toBeGreaterThan(0);
    expect(result.sessions[0].totals.inputTokens).toBeGreaterThan(0);
  });

  it('copilot warns when OpenTelemetry export is missing or empty', async () => {
    const missing = await parseFixture(copilotParser, 'copilot', 'missing-fields');
    expect(missing.sessions).toHaveLength(0);
    expect(missing.warnings.some((w) => w.code === 'missing-token-fields')).toBe(true);

    const corrupt = await parseFixture(copilotParser, 'copilot', 'corrupt');
    expect(corrupt.warnings.length).toBeGreaterThan(0);
  });

  it('sqlite-backed parsers open provider databases read-only', async () => {
    const spy = vi.spyOn(providerSqlite, 'openProviderDatabase');
    try {
      for (const [parser, provider] of [
        [gooseParser, 'goose'],
        [hermesParser, 'hermes'],
        [kiloParser, 'kilo'],
        [opencodeParser, 'opencode'],
        [cursorParser, 'cursor'],
      ] as const) {
        await parseFixture(parser, provider, 'valid');
      }
      expect(spy.mock.calls.length).toBeGreaterThan(0);
      for (const call of spy.mock.calls) {
        expect(call[1]?.readonly ?? true).toBe(true);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('cursor does not invent tokens unless estimation enabled', async () => {
    const md = await cursorParser.parse(fixture('cursor', 'missing-fields', 'md'), {
      privacyMode: 'disabled',
      estimatePromptOnlySources: false,
    });
    expect(md.sessions[0]?.messages.every((m) => !m.inputTokens && !m.outputTokens)).toBe(true);
  });

  it('specstory does not invent tokens unless estimation enabled', async () => {
    const result = await specstoryParser.parse(fixture('specstory', 'missing-fields'), {
      privacyMode: 'disabled',
      estimatePromptOnlySources: false,
    });
    expect(result.sessions[0]?.messages.every((m) => !m.inputTokens && !m.outputTokens)).toBe(true);
  });

  it('opencode parses legacy json and sqlite fixtures', async () => {
    const legacy = await parseFixture(opencodeParser, 'opencode', 'legacy-valid');
    expect(legacy.sessions).toHaveLength(1);

    const sqlite = await parseFixture(opencodeParser, 'opencode', 'valid');
    expect(sqlite.sessions.length).toBeGreaterThan(0);
  });

  it('goose/hermes/kilo sqlite parsers read fixture databases', async () => {
    for (const [parser, provider] of [
      [gooseParser, 'goose'],
      [hermesParser, 'hermes'],
      [kiloParser, 'kilo'],
    ] as const) {
      const result = await parseFixture(parser, provider, 'valid');
      expect(result.sessions.length).toBeGreaterThan(0);
      expect(result.sessions[0].totals.inputTokens + result.sessions[0].totals.outputTokens).toBeGreaterThan(0);
    }
  });

  it('cursor parses markdown and sqlite prompt history', async () => {
    const md = await parseFixture(cursorParser, 'cursor', 'valid', 'md');
    expect(md.sessions).toHaveLength(1);

    const db = await parseFixture(cursorParser, 'cursor', 'valid');
    expect(db.sessions.length).toBeGreaterThan(0);
  });

  it('crush is detection-only and returns no sessions', async () => {
    const result = await parseFixture(crushParser, 'crush', 'valid');
    expect(result.sessions).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'detected-only')).toBe(true);
  });
});
