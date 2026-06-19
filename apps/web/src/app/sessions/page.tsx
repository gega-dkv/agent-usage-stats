'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { formatNumber, formatCurrency, formatDate, providerLabel, providerBadge } from '@/lib/format';
import { listProviderIds, getProviderDefinition } from '@agent-usage/shared';
import { ScanButton } from '@/components/scan-button';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<'date' | 'cost' | 'tokens' | 'provider' | 'model'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const providerOptions = listProviderIds().map((id) => ({
    id,
    label: getProviderDefinition(id)?.label ?? id,
  }));

  const fetchSessions = () => {
    setLoading(true);
    fetch(`/api/sessions?limit=200&orderBy=${sortField}`)
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSessions();
  }, [sortField]);

  const filtered = sessions
    .filter((s) => providerFilter === 'all' || s.provider === providerFilter)
    .filter((s) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        s.id.toLowerCase().includes(q) ||
        s.projectName?.toLowerCase().includes(q) ||
        s.model?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      if (sortField === 'date') {
        return ((a.updatedAt || '').localeCompare(b.updatedAt || '') * dir);
      }
      if (sortField === 'cost') {
        return (a.estimatedCost - b.estimatedCost) * dir;
      }
      if (sortField === 'provider') {
        return a.provider.localeCompare(b.provider) * dir;
      }
      if (sortField === 'model') {
        return (a.model || '').localeCompare(b.model || '') * dir;
      }
      return (a.totalTokens - b.totalTokens) * dir;
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} of {sessions.length} sessions
          </p>
        </div>
        <ScanButton variant="compact" />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search sessions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-48"
            />
          </div>
          <div className="h-6 w-px bg-border" />
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Provider</Label>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {providerOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Sort</Label>
              <Select value={sortField} onValueChange={(v) => setSortField(v as typeof sortField)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="cost">Cost</SelectItem>
                  <SelectItem value="tokens">Tokens</SelectItem>
                  <SelectItem value="provider">Provider</SelectItem>
                  <SelectItem value="model">Model</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              title="Toggle sort direction"
            >
              {sortDirection === 'asc' ? '↑' : '↓'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h3 className="mt-4 font-semibold">No sessions found</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Run a scan to import session data.
          </p>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => {
                    window.location.href = `/sessions/${encodeURIComponent(s.id)}`;
                  }}
                >
                  <TableCell>
                    <Badge variant="outline" className={providerBadge(s.provider)}>
                      {providerLabel(s.provider)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {s.projectName || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {s.model || '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(s.updatedAt)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatNumber(s.inputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatNumber(s.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatNumber(s.totalTokens)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.supportLevel ? <Badge variant="secondary">{s.supportLevel}</Badge> : null}
                      {s.usageConfidence ? (
                        <Badge variant="secondary">{s.usageConfidence}</Badge>
                      ) : null}
                      {s.costEstimated ? <Badge variant="outline">est. cost</Badge> : null}
                      {s.tokenUsageEstimated ? <Badge variant="outline">est. tokens</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatCurrency(s.estimatedCost)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
