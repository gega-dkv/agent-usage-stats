import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { piAgentParser } from '../src/pi-agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'pi-agent');

function fixture(name: string): string {
  return path.join(fixturesDir, `${name}.jsonl`);
}

describe('pi-agent parser', () => {
  it('routes mixed Codex/Claude turns per-turn and records resolved identity', async () => {
    const result = await piAgentParser.parse(fixture('model-switch'));

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    // Both assistant turns survive; user turns carry no usage.
    const assistants = session.messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(2);

    // Turn 1 served by Codex (model_change context).
    const codex = assistants[0];
    expect(codex.model).toBe('gpt-5.5-codex');
    expect(codex.metadata?.resolvedProvider).toBe('codex');
    expect(codex.metadata?.resolvedModel).toBe('gpt-5.5-codex');
    expect(codex.inputTokens).toBe(1000);
    expect(codex.cacheReadTokens).toBe(200);
    expect(codex.outputTokens).toBe(120);

    // Turn 2 served by Claude after a mid-file model_change.
    const claude = assistants[1];
    expect(claude.model).toBe('claude-sonnet-4-5');
    expect(claude.metadata?.resolvedProvider).toBe('claude');
    expect(claude.metadata?.resolvedModel).toBe('claude-sonnet-4-5');
    expect(claude.inputTokens).toBe(1500);
    expect(claude.cacheCreationTokens).toBe(300);
    expect(claude.cacheReadTokens).toBe(400);
    expect(claude.outputTokens).toBe(250);

    // Single pi-agent session aggregates tokens from both backends.
    expect(session.totals.inputTokens).toBe(1000 + 1500);
    expect(session.totals.outputTokens).toBe(120 + 250);
  });
});
