'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { providerLabel } from '@/lib/format';

type Provider = 'codex' | 'claude' | 'gemini';
type SyncTarget = Provider | 'all';

type AgentInstallation = {
  provider: Provider;
  label: string;
  path: string;
  installed: boolean;
};

type ScanButtonProps = {
  variant?: 'default' | 'compact';
};

const syncSteps = ['Detecting agents', 'Reading sessions', 'Writing local database', 'Refreshing charts'];

export function ScanButton({ variant = 'default' }: ScanButtonProps) {
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentInstallation[]>([]);
  const [selected, setSelected] = useState<SyncTarget>('all');
  const [result, setResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
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

  const handleScan = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selected }),
      });
      const data = await res.json();
      if (data.error) {
        setResult({ type: 'error', message: data.error });
      } else {
        setResult({
          type: 'success',
          message: `Synced ${data.sessionsFound} sessions from ${data.filesScanned} files`,
        });
        router.refresh();
      }
    } catch (e) {
      setResult({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
      setTimeout(() => setResult(null), 5000);
    }
  };

  const disabled = loading || installedAgents.length === 0;

  if (variant === 'compact') {
    return (
      <button
        onClick={handleScan}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? <SpinnerIcon /> : <SyncIcon />}
        {loading ? 'Syncing...' : installedAgents.length === 0 ? 'No agents found' : 'Sync'}
      </button>
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
              <button
                key={target.value}
                onClick={() => setSelected(target.value)}
                disabled={loading}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {target.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          onClick={handleScan}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <SpinnerIcon /> : <SyncIcon />}
          {loading ? 'Syncing...' : syncButtonLabel(selected, installedAgents)}
        </button>
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

      {loading && <SyncAnimation target={selected} />}
    </div>
  );
}

function syncButtonLabel(selected: SyncTarget, installedAgents: AgentInstallation[]) {
  if (installedAgents.length === 0) return 'No agents found';
  if (selected === 'all') return installedAgents.length > 1 ? 'Sync All' : `Sync ${installedAgents[0].label}`;
  return `Sync ${providerLabel(selected)}`;
}

function SyncAnimation({ target }: { target: SyncTarget }) {
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
          <span className="font-mono text-[11px] text-muted-foreground">live</span>
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

function SyncIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
