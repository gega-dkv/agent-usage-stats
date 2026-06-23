import { invoke } from '@tauri-apps/api/core';

/**
 * Sidecar API layer.
 *
 * The data layer (@agent-usage/db, parsers, core, pricing) runs inside a
 * Node sidecar — the existing CLI `dashboard` command serving the Next.js
 * `/api/*` routes on a localhost port. This module resolves that origin and
 * exposes fetch helpers that every page consumes.
 *
 * In the Tauri webview the origin is owned by Rust and exposed via the
 * `get_server_url` command. When the same code runs in a plain browser
 * (Vite dev without Tauri), we fall back to the env override or the default
 * port so you can develop the SPA against a manually-started sidecar.
 */

const FALLBACK_PORT = 3847;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let resolvedBase: string | null = null;
let resolving: Promise<string> | null = null;

function defaultBase(): string {
  const fromEnv =
    (import.meta.env.AGENT_USAGE_DASHBOARD_PORT as string | undefined) ??
    (import.meta.env.VITE_DASHBOARD_PORT as string | undefined);
  const port = fromEnv || String(FALLBACK_PORT);
  return `http://127.0.0.1:${port}`;
}

/** Resolve the sidecar origin, caching the result after the first call. */
export async function getBaseUrl(): Promise<string> {
  if (resolvedBase) return resolvedBase;
  if (resolving) return resolving;

  resolving = (async () => {
    let base = defaultBase();
    if (isTauri()) {
      try {
        const url = await invoke<string>('get_server_url');
        if (url) base = url.replace(/\/$/, '');
      } catch {
        /* fall back to default port */
      }
    }
    resolvedBase = base;
    return base;
  })();

  return resolving;
}

/** Force a re-resolution (e.g. after the sidecar restarts on a new port). */
export function resetBaseUrl(): void {
  resolvedBase = null;
  resolving = null;
}

/** Turn a relative `/api/...` path into an absolute sidecar URL. */
export async function apiUrl(path: string): Promise<string> {
  const base = await getBaseUrl();
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Typed JSON GET for the `useQuery` hook. */
export async function fetchJson<T>(path: string): Promise<T> {
  const url = await apiUrl(path);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? '';
    } catch {
      /* ignore parse errors */
    }
    throw new Error(detail || `Request failed (${res.status} ${res.statusText})`);
  }
  return (await res.json()) as T;
}

export type FetchInit = Omit<RequestInit, 'body'> & {
  parse?: 'json' | 'text' | 'none';
  /** Request body. Objects/arrays are JSON-stringified automatically. */
  body?: unknown;
};

/** Generic request helper for POST/PUT/DELETE with a JSON body. */
export async function request<T = unknown>(path: string, init: FetchInit = {}): Promise<T> {
  const url = await apiUrl(path);
  const { parse = 'json', headers, body, ...rest } = init;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    ...rest,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const b = (await res.json()) as { error?: string; message?: string };
      detail = b.error ?? b.message ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status} ${res.statusText})`);
  }

  if (parse === 'none') return undefined as T;
  if (parse === 'text') return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

/** POST JSON, returning the parsed body. */
export function postJson<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body });
}

/**
 * Poll a relative sidecar path until it responds (used by the boot overlay to
 * detect when the sidecar has finished starting). Resolves true on the first
 * OK/any response, false on timeout.
 */
export async function waitForSidecar(opts: {
  path?: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  const { path = '/api/scan', intervalMs = 400, timeoutMs = 30_000, signal } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    try {
      const url = await apiUrl(path);
      const res = await fetch(url, { signal });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/** Whether we're running inside the Tauri webview (vs. a plain browser). */
export const runningInTauri = isTauri;
