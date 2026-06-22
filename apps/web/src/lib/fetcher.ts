/**
 * Tiny typed JSON fetcher for the useQuery hook. Throws on non-OK responses
 * with a descriptive error message pulled from the response body when present.
 */
export async function fetchJson<T>(url: string): Promise<T> {
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
