'use client';

import { Suspense, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { Search, ArrowUp, ArrowDown, MessageSquare } from 'lucide-react';
import { listProviderIds, getProviderDefinition } from '@agent-usage/shared';
import { useQuery } from '@/lib/use-query';
import { fetchJson } from '@/lib/fetcher';
import { useUrlFilters } from '@/lib/use-filters';
import { formatNumber, formatCurrency, formatDate } from '@/lib/format';
import { ScanButton } from '@/components/scan-button';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ProviderBadge, ConfidenceBadge } from '@/components/provider-badge';
import { cn } from '@/lib/utils';

type Session = {
  id: string;
  provider: string;
  projectPath?: string;
  projectName?: string;
  startedAt?: string;
  updatedAt?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  estimatedCost: number;
  model?: string;
  supportLevel?: string;
  usageConfidence?: string;
  costEstimated?: boolean;
  tokenUsageEstimated?: boolean;
};

type SortField = 'date' | 'cost' | 'tokens' | 'provider' | 'model';
type SortDir = 'asc' | 'desc';

const DEFAULTS = { sort: 'date' as SortField, dir: 'desc' as SortDir, provider: 'all', q: '' };

const SORT_LABELS: Record<SortField, string> = {
  date: 'Date',
  cost: 'Cost',
  tokens: 'Tokens',
  provider: 'Provider',
  model: 'Model',
};

export default function SessionsPage() {
  // useSearchParams (via useUrlFilters) requires a Suspense boundary for static prerender.
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <SessionsContent />
    </Suspense>
  );
}

function SessionsContent() {
  const { filters, setFilter } = useUrlFilters(DEFAULTS);
  const sortField = filters.sort as SortField;
  const sortDirection = filters.dir as SortDir;
  const providerFilter = filters.provider;
  const search = filters.q;
  const setSearch = (v: string) => setFilter('q', v);

  const providerOptions = useMemo(
    () => listProviderIds().map((id) => ({ id, label: getProviderDefinition(id)?.label ?? id })),
    [],
  );

  // Fetch ordered by the sort field; client-side filtering on provider + search.
  const { data, loading } = useQuery<{ sessions: Session[] }>(
    `/api/sessions?limit=200&orderBy=${sortField}`,
    { fetcher: (key) => fetchJson(key) },
  );

  const sessions = data?.sessions ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sessions
      .filter((s) => providerFilter === 'all' || s.provider === providerFilter)
      .filter((s) => {
        if (!q) return true;
        return (
          s.id.toLowerCase().includes(q) ||
          s.projectName?.toLowerCase().includes(q) ||
          s.model?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const dir = sortDirection === 'asc' ? 1 : -1;
        if (sortField === 'date') return (a.updatedAt || '').localeCompare(b.updatedAt || '') * dir;
        if (sortField === 'cost') return (a.estimatedCost - b.estimatedCost) * dir;
        if (sortField === 'provider') return a.provider.localeCompare(b.provider) * dir;
        if (sortField === 'model') return (a.model || '').localeCompare(b.model || '') * dir;
        return (a.totalTokens - b.totalTokens) * dir;
      });
  }, [sessions, providerFilter, search, sortField, sortDirection]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Sessions</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filtered.length} of {sessions.length} sessions
          </p>
        </div>
        <ScanButton variant="compact" />
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Project, model, id…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-56 pl-8"
              />
            </div>
          </div>
          <div className="h-6 w-px self-end bg-border" />
          <FilterField label="Provider">
            <Select value={providerFilter} onValueChange={(v) => setFilter('provider', v)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providerOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <div className="ml-auto flex items-end gap-2">
            <FilterField label="Sort">
              <Select value={sortField} onValueChange={(v) => setFilter('sort', v)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABELS) as SortField[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {SORT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setFilter('dir', sortDirection === 'asc' ? 'desc' : 'asc')}
              title={`Sort ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <SessionsSkeleton />
      ) : filtered.length === 0 ? (
        <SessionsEmpty hasAny={sessions.length > 0} />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Provider</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead className="pr-5 text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id} className="group">
                    <TableCell className="pl-5">
                      <ProviderBadge provider={s.provider} />
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/sessions/${encodeURIComponent(s.id)}`}
                        className="block max-w-[180px] truncate font-medium hover:text-primary"
                        title={s.projectName || s.id}
                      >
                        {s.projectName || <span className="text-muted-foreground">—</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{s.model || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(s.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs nums text-muted-foreground">
                      {formatNumber(s.inputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs nums text-muted-foreground">
                      {formatNumber(s.outputTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs nums font-semibold">
                      {formatNumber(s.totalTokens)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.usageConfidence && <ConfidenceBadge confidence={s.usageConfidence} />}
                        {s.costEstimated && (
                          <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                            est. $
                          </span>
                        )}
                        {s.tokenUsageEstimated && (
                          <span className="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                            est. tok
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="pr-5 text-right font-mono text-xs nums font-semibold">
                      {formatCurrency(s.estimatedCost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SessionsSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className={cn('m-2 h-12', i === 0 && 'mt-3')} />
        ))}
      </div>
    </Card>
  );
}

function SessionsEmpty({ hasAny }: { hasAny: boolean }) {
  return (
    <Card className="border-dashed">
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-sm font-semibold">{hasAny ? 'No matching sessions' : 'No sessions yet'}</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {hasAny
            ? 'Try adjusting your search or filters.'
            : 'Run a sync to import session data from your installed agents.'}
        </p>
      </div>
    </Card>
  );
}
