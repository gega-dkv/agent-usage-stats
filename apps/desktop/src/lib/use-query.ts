import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data-fetching layer: dedupes concurrent requests for the same key,
 * revalidates on window focus, and exposes loading/error/data state.
 *
 * Deliberately tiny (no SWR/React Query) to keep the local-first bundle lean.
 * Keys are strings; pass `null` to disable a query.
 *
 * NOTE: unlike the web app, fetchers here must resolve keys to absolute
 * sidecar URLs (see `apiUrl()` in lib/api.ts). The key is treated as an
 * opaque cache identity, not a URL.
 */

type FetcherResult<T> = T | Promise<T>;

const cache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, fn: () => void) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    listeners.get(key)?.delete(fn);
  };
}

export interface UseQueryOptions<T> {
  /** Fetcher function; receives the opaque key (resolve to a real URL inside). */
  fetcher: (key: string) => FetcherResult<T>;
  /** Refetch on window focus (default true). */
  revalidateOnFocus?: boolean;
  /** Keep previous data visible while refetching (default true). */
  keepPreviousData?: boolean;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** Imperatively revalidate (and bypass cache for one fetch). */
  mutate: () => Promise<void>;
}

export function useQuery<T>(key: string | null, options: UseQueryOptions<T>): UseQueryResult<T> {
  const { fetcher, revalidateOnFocus = true, keepPreviousData = true } = options;
  const safeKey = key ?? '';
  const [data, setData] = useState<T | undefined>(() =>
    safeKey ? (cache.get(safeKey) as T | undefined) : undefined,
  );
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState<boolean>(!data && Boolean(safeKey));
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(
    async (bypassCache = false) => {
      if (!safeKey) return;
      if (!bypassCache && cache.has(safeKey)) {
        setData(cache.get(safeKey) as T);
        setLoading(false);
        setError(undefined);
        return;
      }
      let promise = inFlight.get(safeKey) as Promise<T> | undefined;
      if (!promise || bypassCache) {
        promise = Promise.resolve(fetcherRef.current(safeKey));
        inFlight.set(safeKey, promise);
      }
      setLoading((prev) => prev || !keepPreviousData);
      try {
        const result = await promise;
        cache.set(safeKey, result);
        setData(result);
        setError(undefined);
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        inFlight.delete(safeKey);
        setLoading(false);
        notify(safeKey);
      }
    },
    [safeKey, keepPreviousData],
  );

  // Re-run when the key changes.
  useEffect(() => {
    if (!safeKey) {
      setData(undefined);
      setError(undefined);
      setLoading(false);
      return;
    }
    run(false);
    const unsub = subscribe(safeKey, () => {
      const next = cache.get(safeKey) as T | undefined;
      if (next !== undefined) setData(next);
    });
    return unsub;
  }, [safeKey, run]);

  // Revalidate on focus.
  useEffect(() => {
    if (!revalidateOnFocus || !safeKey) return;
    const onFocus = () => {
      if (!inFlight.has(safeKey)) run(true);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [safeKey, run, revalidateOnFocus]);

  const mutate = useCallback(async () => {
    await run(true);
  }, [run]);

  return { data, error, loading, mutate };
}

/** Imperatively prime the cache (e.g. after a mutation). */
export function mutateCache<T>(key: string, value: T | ((prev: T | undefined) => T)): void {
  const prev = cache.get(key) as T | undefined;
  const next = typeof value === 'function' ? (value as (p: T | undefined) => T)(prev) : value;
  cache.set(key, next);
  notify(key);
}

/** Drop a key from cache (e.g. when invalidating after a settings change). */
export function invalidateCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    cache.clear();
    listeners.forEach((set) => set.forEach((fn) => fn()));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) {
      cache.delete(key);
      notify(key);
    }
  }
}
