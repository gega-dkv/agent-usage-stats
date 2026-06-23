import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { providerLabel } from '@/lib/format';
import { fetchJson, postJson } from '@/lib/api';
import { invalidateCache } from '@/lib/use-query';
import { Button } from '@/components/ui/button';

type SyncTarget = string;

type AgentInstallation = {
  provider: string;
  label: string;
  path: string;
  installed: boolean;
};

type ScanButtonProps = {
  variant?: 'default' | 'compact';
  onComplete?: () => void;
};

const syncSteps = ['Detecting agents', 'Reading sessions', 'Writing local database', 'Refreshing charts'];

/**
 * Trigger an async scan and poll for completion. Resolves the scan run on
 * completion/failure. Shared by the ScanButton and the menu/tray "rescan".
 */
export async function runScan({
  provider,
  onUpdate,
  signal,
}: {
  provider?: string;
  onUpdate?: (progress: { filesScanned?: number; sessionsFound?: number } | null) => void;
  signal?: { cancelled: boolean };
} = {}): Promise<{ sessionsFound: number; filesScanned: number }> {
  const data = await postJson<{ runId?: number; sessionsFound?: number; error?: string; status?: string }>(
    '/api/scan',
    { provider: provider ?? 'all', async: true },
  );
  if (data.error) throw new Error(data.error);

  if (!data.runId) {
    // Synchronous path (rare) — already done.
    return { sessionsFound: data.sessionsFound ?? 0, filesScanned: 0 };
  }

  // Poll until the scan run reaches a terminal state.
  let attempts = 0;
  while (attempts++ < 120) {
    if (signal?.cancelled) throw new Error('Scan cancelled');
    await new Promise((r) => setTimeout(r, 800));
    const status = await fetchJson<{ run?: { status: string; sessionsFound: number; filesScanned: number; errors?: string } }>(
      `/api/scan?runId=${data.runId}`,
    );
    const run = status.run;
    if (!run) continue;
    onUpdate?.({ filesScanned: run.filesScanned, sessionsFound: run.sessionsFound });
    if (run.status === 'completed') return { sessionsFound: run.sessionsFound, filesScanned: run.filesScanned };
    if (run.status === 'failed') throw new Error(run.errors || 'Scan failed');
  }
  throw new Error('Scan timed out');
}

/** Kick off a full rescan, refresh caches, and toast the outcome. Used by the
 *  native menu/tray and the ⌘K palette without needing a focused ScanButton. */
export async function triggerGlobalRescan(): Promise<void> {
  const t = toast.loading('Syncing sessions…');
  try {
    const { sessionsFound, filesScanned } = await runScan({ provider: 'all' });
    invalidateCache('/api/');
    toast.success(`Synced ${sessionsFound} sessions`, {
      id: t,
      description: filesScanned ? `From ${filesScanned} files` : undefined,
    });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Sync failed', { id: t });
  }
}

export function ScanButton({ variant = 'default', onComplete }: ScanButtonProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ filesScanned?: number; sessionsFound?: number } | null>(null);
  const [agents, setAgents] = useState<AgentInstallation[]>([]);
  const [selected, setSelected] = useState<SyncTarget>('all');
  const cancelledRef = useRef(false);

  const installedAgents = useMemo(() => agents.filter((agent) => agent.installed), [agents]);

  useEffect(() => {
    fetchJson<{ agents?: AgentInstallation[] }>('/api/providers')
      .then((data) => {
        const nextAgents = data.agents || [];
        setAgents(nextAgents);
        const installed = nextAgents.filter((agent) => agent.installed);
        setSelected(installed.length === 1 ? installed[0].provider : 'all');
      })
      .catch(() => setAgents([]));
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleScan = async () => {
    setLoading(true);
    setProgress(null);
    cancelledRef.current = false;
    try {
      const { sessionsFound, filesScanned } = await runScan({
        provider: selected === 'all' ? undefined : selected,
        onUpdate: setProgress,
        signal: { cancelled: cancelledRef.current },
      });
      invalidateCache('/api/');
      toast.success('Sync complete', {
        description: `${sessionsFound} sessions${filesScanned ? ` from ${filesScanned} files` : ''}`,
      });
      onComplete?.();
    } catch (e) {
      toast.error('Scan failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const disabled = loading || installedAgents.length === 0;

  if (variant === 'compact') {
    return (
      <Button onClick={handleScan} disabled={disabled} variant="outline" size="sm">
        {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {loading
          ? progress?.sessionsFound != null
            ? `${progress.sessionsFound} sessions…`
            : 'Syncing…'
          : installedAgents.length === 0
            ? 'No agents found'
            : 'Sync'}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:items-end">
      {installedAgents.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
          {[
            { value: 'all' as SyncTarget, label: 'Sync All' },
            ...installedAgents.map((agent) => ({ value: agent.provider, label: agent.label })),
          ].map((target) => {
            const active = selected === target.value;
            return (
              <Button
                key={target.value}
                onClick={() => setSelected(target.value)}
                disabled={loading}
                variant={active ? 'default' : 'ghost'}
                size="sm"
                className="text-xs"
              >
                {target.label}
              </Button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button onClick={handleScan} disabled={disabled}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {loading ? 'Syncing…' : syncButtonLabel(selected, installedAgents)}
        </Button>
      </div>

      {loading && (
        <SyncAnimation
          target={selected}
          filesScanned={progress?.filesScanned}
          sessionsFound={progress?.sessionsFound}
        />
      )}
    </div>
  );
}

function syncButtonLabel(selected: SyncTarget, installedAgents: AgentInstallation[]) {
  if (installedAgents.length === 0) return 'No agents found';
  if (selected === 'all') {
    return installedAgents.length > 1 ? 'Sync All' : `Sync ${installedAgents[0].label}`;
  }
  return `Sync ${providerLabel(selected)}`;
}

function SyncAnimation({
  target,
  filesScanned,
  sessionsFound,
}: {
  target: SyncTarget;
  filesScanned?: number;
  sessionsFound?: number;
}) {
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="h-1 overflow-hidden bg-muted">
        <div className="h-full w-1/2 animate-sync-bar rounded-full bg-primary" />
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            {target === 'all' ? 'Local sync' : providerLabel(target)}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {sessionsFound != null ? `${sessionsFound} sessions` : 'polling…'}
            {filesScanned != null ? ` · ${filesScanned} files` : ''}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {syncSteps.map((step, index) => (
            <div
              key={step}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
              style={{ animationDelay: `${index * 120}ms` }}
            >
              <span className="size-1.5 animate-sync-dot rounded-full bg-primary" />
              <span className="truncate">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
