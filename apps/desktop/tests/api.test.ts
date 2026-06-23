import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiUrl,
  fetchJson,
  waitForSidecar,
  resetBaseUrl,
  runningInTauri,
} from '../src/lib/api.js';

describe('api (sidecar URL layer)', () => {
  afterEach(() => {
    resetBaseUrl();
    vi.restoreAllMocks();
  });

  it('reports a non-Tauri environment in the node test runner', () => {
    expect(runningInTauri()).toBe(false);
  });

  it('resolves a relative path against the default sidecar base', async () => {
    expect(await apiUrl('/api/stats')).toBe('http://127.0.0.1:3847/api/stats');
  });

  it('passes absolute URLs through untouched', async () => {
    const abs = 'http://127.0.0.1:9999/api/health';
    expect(await apiUrl(abs)).toBe(abs);
  });

  it('fetchJson parses a JSON response and throws on non-OK', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const out = await fetchJson<{ ok: boolean }>('/api/scan');
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fetchJson surfaces the server error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 }),
    );
    await expect(fetchJson('/api/scan')).rejects.toThrow('boom');
  });

  it('waitForSidecar returns true once the sidecar responds < 500', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const up = await waitForSidecar({ intervalMs: 10, timeoutMs: 1000 });
    expect(up).toBe(true);
  });

  it('waitForSidecar returns false on timeout when nothing responds', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const up = await waitForSidecar({ intervalMs: 5, timeoutMs: 60 });
    expect(up).toBe(false);
  });
});
