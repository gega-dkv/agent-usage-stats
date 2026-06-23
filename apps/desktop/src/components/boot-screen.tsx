import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { waitForSidecar, runningInTauri } from '@/lib/api';

type ServerStatus = {
  status?: 'starting' | 'ready' | 'failed';
  message?: string;
  logs?: string[];
  url?: string;
};

const TOTAL_TIMEOUT_MS = 180_000; // 3 min — Next dev first-compile can be slow.

/**
 * Full-screen boot overlay shown while the Node sidecar is coming up, or if it
 * fails to start. Replaces the old silent splash + redirect: it surfaces the
 * server status and recent log lines so the user isn't staring at a blank pane.
 *
 * Readiness is gated by the SPA's OWN fetch to the sidecar (not just Rust's
 * status), because the CLI prints its metadata immediately but the Next.js
 * server still needs to compile before `/api/*` responds.
 */
export function BootScreen({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<ServerStatus>({ status: 'starting' });
  const [timedOut, setTimedOut] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // The SPA's fetch is the authoritative readiness gate. It keeps retrying for
  // up to TOTAL_TIMEOUT_MS, then offers a Retry button instead of giving up.
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    (async () => {
      const deadline = Date.now() + TOTAL_TIMEOUT_MS;
      // First, short-circuit if Rust already reports ready.
      if (runningInTauri()) {
        try {
          const s = await invoke<ServerStatus>('get_server_status');
          if (!cancelled) setStatus(s);
        } catch {
          /* keep polling */
        }
      }
      while (Date.now() < deadline) {
        if (cancelled) return;
        const up = await waitForSidecar({
          timeoutMs: 2000,
          intervalMs: 400,
          signal: abort.signal,
        });
        if (up) {
          if (!cancelled) onReadyRef.current();
          return;
        }
        // Refresh status/logs between attempts so the pane stays informative.
        if (runningInTauri() && !cancelled) {
          try {
            const s = await invoke<ServerStatus>('get_server_status');
            if (!cancelled) setStatus(s);
          } catch {
            /* ignore */
          }
        }
      }
      if (!cancelled) setTimedOut(true);
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [retryNonce]);

  const retry = useCallback(() => {
    setTimedOut(false);
    setRetryNonce((n) => n + 1);
  }, []);

  const failed = timedOut || status.status === 'failed';
  // Rust only marks `failed` when the sidecar process actually exited; a mere
  // timeout leaves status `starting`. So distinguish the two cases for messaging.
  const childExited = status.status === 'failed';
  const cliStarted = Boolean(status.url); // CLI metadata arrived → server spawned.

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-indigo-500 text-primary-foreground shadow-popover">
        <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 5-5" />
        </svg>
      </div>

      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold tracking-tight">Agent Usage Stats</h1>
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {!failed && <Loader2 className="h-4 w-4 animate-spin" />}
          {failed
            ? childExited
              ? 'The local data server stopped.'
              : 'Still warming up — the local server is taking a while.'
            : cliStarted
              ? 'Compiling the dashboard…'
              : 'Starting the local data server…'}
        </p>
      </div>

      {failed && (
        <div className="flex max-w-md flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-left">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                {childExited
                  ? 'The local data server exited.'
                  : cliStarted
                    ? 'The data server started but is still compiling.'
                    : 'The dashboard didn’t come up in time.'}
              </p>
              <p className="text-muted-foreground">
                {childExited ? (
                  <>
                    The CLI process stopped before the dashboard came up. From a source checkout, run{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">pnpm build</code> first so the
                    bundled CLI dashboard exists, then retry.
                  </>
                ) : cliStarted ? (
                  <>
                    The local server printed its startup metadata, so the CLI launched — the Next.js dashboard just
                    needs more time to compile on first run. Click <strong>Retry</strong> to keep waiting.
                  </>
                ) : (
                  <>
                    Make sure the local data server is available. From a source checkout, run{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">pnpm build</code> first so the
                    bundled CLI dashboard exists, then retry.
                  </>
                )}
              </p>
              {status.message && (
                <p className="font-mono text-[11px] text-warning/80">{status.message}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
          {status.logs && status.logs.length > 0 && (
            <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {status.logs.slice(-30).join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
