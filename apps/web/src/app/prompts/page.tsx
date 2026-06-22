'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { Search, ChevronLeft, ChevronRight, ShieldAlert, Tags } from 'lucide-react';
import { listProviderIds, getProviderDefinition } from '@agent-usage/shared';
import { useQuery } from '@/lib/use-query';
import { fetchJson } from '@/lib/fetcher';
import { useUrlFilters } from '@/lib/use-filters';
import { formatNumber, formatCurrency, formatDateTime, formatRelativeTime } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProviderBadge } from '@/components/provider-badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Prompt = {
  id: string;
  sessionId: string;
  timestamp: string;
  role: string;
  model: string | null;
  contentPreview: string;
  contentHidden: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  simulatedCost: number | null;
  provider: string;
  projectName: string | null;
  supportLevel?: string;
  hasReliableTokens?: boolean;
  noReliableUsageMessage?: string;
};

type PromptsResponse = { results: Prompt[]; pagination?: { total?: number; offset?: number } };

const PAGE_SIZE = 25;

const DEFAULTS = {
  q: '',
  provider: 'all',
  model: '',
  project: '',
  from: '',
  to: '',
  viewMode: 'preview',
  offset: '0',
};

export default function PromptsPage() {
  // useSearchParams (via useUrlFilters) requires a Suspense boundary for static prerender.
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <PromptsContent />
    </Suspense>
  );
}

function PromptsContent() {
  const { filters, setFilter } = useUrlFilters(DEFAULTS);

  const providerOptions = useMemo(
    () => listProviderIds().map((id) => ({ id, label: getProviderDefinition(id)?.label ?? id })),
    [],
  );

  const { data: privacy } = useQuery<{ privacyMode?: string }>('privacy-mode', {
    fetcher: () => fetchJson('/api/privacy'),
  });

  // Build the fetch key from filters so changing any re-fetches (debounced via search).
  const offset = Number(filters.offset || '0');
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    viewMode: filters.viewMode,
  });
  if (filters.q) params.set('q', filters.q);
  if (filters.provider !== 'all') params.set('provider', filters.provider);
  if (filters.model) params.set('model', filters.model);
  if (filters.project) params.set('project', filters.project);
  if (filters.from) params.set('from', new Date(filters.from).toISOString());
  if (filters.to) params.set('to', new Date(`${filters.to}T23:59:59`).toISOString());
  const key = `/api/prompts?${params.toString()}`;

  const { data, loading } = useQuery<PromptsResponse>(key, {
    fetcher: (k) => fetchJson(k),
  });

  const prompts = data?.results ?? [];
  const resetOffset = () => setFilter('offset', '0');

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const hasNext = prompts.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Prompts</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Search and browse user prompts from scanned sessions</p>
      </div>

      {privacy?.privacyMode === 'disabled' && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-xs text-warning/90">
            Privacy mode is disabled — prompt content is not stored by default. Enable preview or full mode in{' '}
            <Link href="/settings" className="font-medium underline">
              Settings
            </Link>
            .
          </p>
        </div>
      )}

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="Search" className="min-w-[14rem] flex-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search prompt content…"
                value={filters.q}
                onChange={(e) => {
                  resetOffset();
                  setFilter('q', e.target.value);
                }}
                className="pl-8"
              />
            </div>
          </FilterField>
          <FilterField label="Provider">
            <Select
              value={filters.provider}
              onValueChange={(v) => {
                resetOffset();
                setFilter('provider', v);
              }}
            >
              <SelectTrigger className="w-[150px]">
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
          <FilterField label="Model">
            <Input
              type="text"
              placeholder="e.g. gpt-4o"
              value={filters.model}
              onChange={(e) => {
                resetOffset();
                setFilter('model', e.target.value);
              }}
              className="w-[120px]"
            />
          </FilterField>
          <FilterField label="Project">
            <Input
              type="text"
              placeholder="name…"
              value={filters.project}
              onChange={(e) => {
                resetOffset();
                setFilter('project', e.target.value);
              }}
              className="w-[120px]"
            />
          </FilterField>
          <FilterField label="From">
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => {
                resetOffset();
                setFilter('from', e.target.value);
              }}
              className="w-[140px]"
            />
          </FilterField>
          <FilterField label="To">
            <Input
              type="date"
              value={filters.to}
              onChange={(e) => {
                resetOffset();
                setFilter('to', e.target.value);
              }}
              className="w-[140px]"
            />
          </FilterField>
          <FilterField label="View">
            <Select value={filters.viewMode} onValueChange={(v) => setFilter('viewMode', v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">Preview</SelectItem>
                <SelectItem value="full">Full content</SelectItem>
                <SelectItem value="hidden">Stats only</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
        </div>
      </Card>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : prompts.length === 0 ? (
        <Card className="border-dashed">
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Tags className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-sm font-semibold">No prompts found</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Try adjusting your search or filters, or run a sync to import more sessions.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="space-y-2.5">
            {prompts.map((p) => (
              <Card key={p.id} className="p-4 transition-shadow hover:shadow-popover">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <ProviderBadge provider={p.provider} />
                  {p.model && <span className="font-mono text-muted-foreground">{p.model}</span>}
                  <Link
                    href={`/sessions/${encodeURIComponent(p.sessionId)}`}
                    className="text-primary hover:underline"
                  >
                    View session →
                  </Link>
                  <span className="ml-auto text-muted-foreground" title={formatDateTime(p.timestamp)}>
                    {formatRelativeTime(p.timestamp)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm">{p.contentPreview}</p>
                {p.contentHidden && (
                  <p className="mt-1.5 text-xs italic text-muted-foreground">
                    Content hidden — stats only
                    {p.supportLevel === 'prompt-history-only' ? ' (prompt-history-only provider)' : ''}
                  </p>
                )}
                {!p.hasReliableTokens && p.noReliableUsageMessage && (
                  <p className="mt-1 text-xs text-warning">{p.noReliableUsageMessage}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  {p.inputTokens != null && <span>In: {formatNumber(p.inputTokens)}</span>}
                  {p.outputTokens != null && <span>Out: {formatNumber(p.outputTokens)}</span>}
                  {p.simulatedCost != null && p.simulatedCost > 0 && (
                    <span>Est. cost: {formatCurrency(p.simulatedCost)}</span>
                  )}
                  {p.projectName && <span className="ml-auto truncate">{p.projectName}</span>}
                </div>
              </Card>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrev}
              onClick={() => setFilter('offset', String(Math.max(0, offset - PAGE_SIZE)))}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {currentPage} · {prompts.length} on this page
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext}
              onClick={() => setFilter('offset', String(offset + PAGE_SIZE))}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
