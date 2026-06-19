'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { providerLabel } from '@/lib/format';
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

export function ScanButton({ variant = 'default', onComplete }: ScanButtonProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ filesScanned?: number; sessionsFound?: number } | null>(
    null,
  );
  const [agents, setAgents] = useState<AgentInstallation[]>([]);
  const [selected, setSelected] = useState<SyncTarget>('all');
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();

  const installedAgents = useMemo(
    () => agents.filter((agent) => agent.installed),
    [agents],
  );

  useEffect(() => {
    fetch('/api/providers')
      .then((res) => res.json())
      .then((data) => {
        const nextAgents = data.agents || [];
        setAgents(nextAgents);
        const installed = nextAgents.filter((agent: AgentInstallation) => agent.installed);
        setSelected(installed.length === 1 ? installed[0].provider : 'all');
      })
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const pollScanStatus = (runId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/scan?runId=${runId}`);
        const data = await res.json();
        const run = data.run;
        if (!run) return;
        setProgress({
          filesScanned: run.filesScanned,
          sessionsFound: run.sessionsFound,
        });
        if (run.status === 'completed' || run.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setLoading(false);
          setProgress(null);
          if (run.status === 'completed') {
            setResult({
              type: 'success',
              message: `Synced ${run.sessionsFound} sessions from ${run.filesScanned} files`,
            });
            router.refresh();
            onComplete?.();
          } else {
            setResult({ type: 'error', message: run.errors || 'Scan failed' });
          }
          setTimeout(() => setResult(null), 5000);
        }
      } catch {
        // keep polling
      }
    }, 800);
  };

  const handleScan = async () => {
    setLoading(true);
    setResult(null);
    setProgress(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selected, async: true }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ type: 'error', message: data.error });
        setLoading(false);
      } else if (data.runId) {
        pollScanStatus(data.runId);
      } else {
        setResult({
          type: 'success',
          message: `Synced ${data.sessionsFound ?? 0} sessions`,
        });
        setLoading(false);
        router.refresh();
        onComplete?.();
        setTimeout(() => setResult(null), 5000);
      }
    } catch (e) {
      setResult({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      setLoading(false);
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
        {result && (
          <span
            className={`max-w-72 text-xs ${
              result.type === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {result.message}
          </span>
        )}
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
