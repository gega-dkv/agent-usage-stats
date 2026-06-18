'use client';

import { useEffect, useState } from 'react';
import { formatNumber, formatCurrency, formatDate, providerLabel, providerBadge } from '@/lib/format';
import { ScanButton } from '@/components/scan-button';

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
};

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<'date' | 'cost' | 'tokens'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

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
        return ((a.estimatedCost - b.estimatedCost) * dir);
      }
      return ((a.totalTokens - b.totalTokens) * dir);
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Provider:</span>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sort:</span>
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as any)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="date">Date</option>
            <option value="cost">Cost</option>
            <option value="tokens">Tokens</option>
          </select>
          <button
            onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background hover:bg-accent"
            title="Toggle sort direction"
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

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
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-muted/30">
                <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3 text-right">Input</th>
                  <th className="px-4 py-3 text-right">Output</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-border text-sm last:border-0 transition hover:bg-muted/30"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${providerBadge(
                          s.provider,
                        )}`}
                      >
                        {providerLabel(s.provider)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {s.projectName || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {s.model || '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(s.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {formatNumber(s.inputTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {formatNumber(s.outputTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {formatNumber(s.totalTokens)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
                      {formatCurrency(s.estimatedCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
