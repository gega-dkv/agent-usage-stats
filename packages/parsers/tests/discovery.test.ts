import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  expandPath,
  detectAgentInstallations,
  getProviderDefaultPaths,
  discoverSessionFiles,
} from '../src/discovery.js';
import { getDefaultConfig } from '@agent-usage/core';

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

describe('discoverSessionFiles custom paths', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Build a synthetic tree mirroring the Gemini CLI layout:
    // tmp/gemini-tree/tmp/proj/chats/session-x.json
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aus-disc-'));
    const chats = path.join(tmpDir, 'gemini-tree', 'tmp', 'proj', 'chats');
    fs.mkdirSync(chats, { recursive: true });
    fs.writeFileSync(
      path.join(chats, 'session-x.json'),
      JSON.stringify({ sessionId: 's1', projectHash: 'h', messages: [] }),
    );
    fs.writeFileSync(path.join(chats, 'logs.json'), '{}');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('expands a bare directory custom path into a recursive glob', async () => {
    const config = getDefaultConfig();
    const bareDir = path.join(tmpDir, 'gemini-tree', 'tmp');
    const files = await discoverSessionFiles(config, [bareDir]);

    // Without expansion this returned 0 files (the dashboard "shows nothing"
    // bug); a bare dir must be treated as dir/**/*.
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.path.endsWith('session-x.json'))).toBe(true);
  });
});
