'use client';

import { useMemo, type ReactNode } from 'react';
import { ScanButton } from '@/components/scan-button';
import { useQuery } from '@/lib/use-query';
import { fetchJson } from '@/lib/fetcher';
import { formatNumber, formatCurrency, formatRelativeTime } from '@/lib/format';
import { providerTheme } from '@/lib/provider-theme';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SupportLevelBadge } from '@/components/provider-badge';
import { cn } from '@/lib/utils';

type ProviderUsage = {
  sessions: number;
  sessionsWithTokens: number;
  exactUsageSessions: number;
  metadataOnlySessions: number;
  estimatedSessions: number;
  totalTokens: number;
  totalCost: number;
  lastSeen: string | null;
};

type ParserWarning = {
  file: string;
  message: string;
  severity: string;
  code?: string;
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
  lastScan: {
    completedAt: string | null;
    filesScanned: number;
    sessionsFound: number;
    warningsCount: number;
  } | null;
  warnings: ParserWarning[];
};

type ProvidersResponse = { agents: ProviderAgent[] };

export default function ProvidersPage() {
  const { data, loading } = useQuery<ProvidersResponse>('providers', {
    fetcher: () => fetchJson('/api/providers'),
  });

  const agents = data?.agents ?? [];

  const { detected, available } = useMemo(() => {
    const det = agents.filter((a) => a.installed);
    const avail = agents.filter((a) => !a.installed);
    return { detected: det, available: avail };
  }, [agents]);

  const parserCount = agents.filter((a) => a.hasParser).length;

  if (loading) {
    return <ProvidersSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Providers</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {detected.length} detected · {parserCount} with parsing · {agents.length} supported
          </p>
        </div>
        <ScanButton variant="compact" />
      </div>

      {detected.length > 0 && (
        <ProviderGroup title="Detected on this machine" count={detected.length}>
          {detected.map((agent) => (
            <ProviderCard key={agent.provider} agent={agent} />
          ))}
        </ProviderGroup>
      )}

      {available.length > 0 && (
        <ProviderGroup title="Available" count={available.length}>
          {available.map((agent) => (
            <ProviderCard key={agent.provider} agent={agent} />
          ))}
        </ProviderGroup>
      )}
    </div>
  );
}

function ProviderGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{count}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function ProviderCard({ agent }: { agent: ProviderAgent }) {
  const theme = providerTheme(agent.provider);
  const hasUsage = agent.usage && agent.usage.sessions > 0;

  return (
    <Card className="flex flex-col gap-3 p-4 transition-shadow hover:shadow-popover">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold uppercase text-white shadow-sm"
            style={{ background: `linear-gradient(135deg, hsl(${theme.solid}), hsl(${theme.hue} 70% 45%))` }}
            aria-hidden
          >
            {agent.label.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight">{agent.label}</h3>
            <code className="text-[11px] text-muted-foreground">{agent.provider}</code>
          </div>
        </div>
        <span
          className={cn(
            'mt-1 h-2 w-2 shrink-0 rounded-full',
            agent.installed ? 'bg-success' : 'bg-muted-foreground/40',
          )}
          title={agent.installed ? 'Installed' : 'Not detected'}
          aria-hidden
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <SupportLevelBadge level={agent.supportLevel as never} />
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {agent.hasParser ? 'parser' : 'detect only'}
        </span>
      </div>

      {hasUsage ? (
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-center">
          <MiniStat label="Sessions" value={formatNumber(agent.usage!.sessions)} />
          <MiniStat label="Tokens" value={formatNumber(agent.usage!.totalTokens)} />
          <MiniStat label="Cost" value={formatCurrency(agent.usage!.totalCost)} />
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
          No sessions ingested yet.
        </p>
      )}

      {agent.usage?.lastSeen && (
        <p className="text-[11px] text-muted-foreground">Last seen {formatRelativeTime(agent.usage.lastSeen)}</p>
      )}

      {agent.warnings.length > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-warning">Recent warnings</p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-warning/80">
            {agent.warnings.slice(0, 3).map((w) => (
              <li key={w.file + w.message} className="truncate" title={w.message}>
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
        <div className="truncate" title={agent.path}>
          <span className="font-medium text-foreground/60">Path:</span> {agent.path || '—'}
        </div>
        {agent.envVars.length > 0 && (
          <div className="truncate">
            <span className="font-medium text-foreground/60">Env:</span> {agent.envVars.join(', ')}
          </div>
        )}
      </div>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}

function ProvidersSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Card key={i} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="mt-1 h-2.5 w-16" />
              </div>
            </div>
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-3 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
