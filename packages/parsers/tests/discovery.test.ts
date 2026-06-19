import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { expandPath, detectAgentInstallations, getProviderDefaultPaths } from '../src/discovery.js';

describe('expandPath', () => {
  it('expands a leading ~ to the home directory', () => {
    const result = expandPath('~/.claude/projects');
    expect(result).toBe(path.join(os.homedir(), '.claude/projects'));
  });

  it('expands $ENV tokens when the variable is set', () => {
    process.env.TEST_DISCOVERY_DIR = '/tmp/discovery';
    expect(expandPath('$TEST_DISCOVERY_DIR/sessions')).toBe('/tmp/discovery/sessions');
    delete process.env.TEST_DISCOVERY_DIR;
  });

  it('returns null when a referenced env var is missing', () => {
    delete process.env.DEFINITELY_NOT_SET_VAR;
    expect(expandPath('$DEFINITELY_NOT_SET_VAR/x')).toBeNull();
  });
});

describe('detectAgentInstallations', () => {
  it('returns an entry for every registered provider', () => {
    const agents = detectAgentInstallations();
    expect(agents.length).toBeGreaterThanOrEqual(19);
    const claude = agents.find((a) => a.provider === 'claude');
    expect(claude?.hasParser).toBe(true);
    expect(claude?.supportLevel).toBe('exact-usage');
  });
});

describe('getProviderDefaultPaths', () => {
  let savedCodexHome: string | undefined;

  beforeEach(() => {
    savedCodexHome = process.env.CODEX_HOME;
  });
  afterEach(() => {
    if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = savedCodexHome;
  });

  it('drops $CODEX_HOME patterns when the env var is unset but keeps ~ ones', () => {
    delete process.env.CODEX_HOME;
    const paths = getProviderDefaultPaths('codex');
    expect(paths.some((p) => p.includes('.codex'))).toBe(true);
    expect(paths.every((p) => !p.includes('$'))).toBe(true);
  });
});
