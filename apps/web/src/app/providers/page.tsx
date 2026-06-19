'use client';

import { useEffect, useState } from 'react';
import { ScanButton } from '@/components/scan-button';
import { formatNumber, formatCurrency } from '@/lib/format';

type ProviderUsage = {
  sessions: number;
  sessionsWithTokens: number;
  estimatedSessions: number;
  totalTokens: number;
  totalCost: number;
  lastSeen: string | null;
};

type ProviderAgent = {
  provider: string;
  label: string;
  path: string;
  installed: boolean;
  hasParser: boolean;
  supportLevel: string;
  envVars: string[];
  sessionPatterns: string[];
  usage: ProviderUsage | null;
};

const SUPPORT_BADGE: Record<string, string> = {
  'exact-usage': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'partial-usage': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  'prompt-history-only': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  'detected-only': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  unsupported: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

export default function ProvidersPage() {
  const [agents, setAgents] = useState<ProviderAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then((d) => {
        setAgents(d.agents || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-96 rounded-2xl bg-muted" />
      </div>
    );
  }

  const detected = agents.filter((a) => a.installed);
  const parserCount = agents.filter((a) => a.hasParser).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Providers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {detected.length} detected · {parserCount} with full parsing · {agents.length} supported
          </p>
        </div>
        <ScanButton variant="compact" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => {
          const badge = SUPPORT_BADGE[agent.supportLevel] ?? SUPPORT_BADGE['detected-only'];
          return (
            <div
              key={agent.provider}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold leading-tight">{agent.label}</h2>
                  <code className="text-[11px] text-muted-foreground">{agent.provider}</code>
                </div>
                <span
                  className={`inline-flex h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                    agent.installed ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                  title={agent.installed ? 'Detected' : 'Not detected'}
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge}`}>
                  {agent.supportLevel}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {agent.hasParser ? 'parser' : 'detect only'}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {agent.installed ? 'detected' : 'not found'}
                </span>
              </div>

              {agent.usage && agent.usage.sessions > 0 ? (
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <Stat label="Sessions" value={String(agent.usage.sessions)} />
                  <Stat label="Tokens" value={formatNumber(agent.usage.totalTokens)} />
                  <Stat label="Cost" value={formatCurrency(agent.usage.totalCost)} />
                  <Stat label="With usage" value={String(agent.usage.sessionsWithTokens)} />
                  <Stat label="Estimated" value={String(agent.usage.estimatedSessions)} />
                  <Stat
                    label="Last seen"
                    value={agent.usage.lastSeen ? agent.usage.lastSeen.slice(0, 10) : '—'}
                  />
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                  No sessions ingested yet.
                </p>
              )}

              <div className="mt-auto space-y-1 text-[11px] text-muted-foreground">
                <div className="truncate" title={agent.path}>
                  <span className="font-medium text-foreground/70">Path:</span> {agent.path}
                </div>
                {agent.envVars.length > 0 && (
                  <div className="truncate">
                    <span className="font-medium text-foreground/70">Env:</span>{' '}
                    {agent.envVars.join(', ')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
