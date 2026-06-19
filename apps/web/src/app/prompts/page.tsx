'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  formatNumber,
  formatCurrency,
  formatDateTime,
  providerLabel,
  providerBadge,
} from '@/lib/format';
import { listProviderIds, getProviderDefinition } from '@agent-usage/shared';

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

const PAGE_SIZE = 50;

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewMode, setViewMode] = useState<'full' | 'preview' | 'hidden'>('preview');
  const [offset, setOffset] = useState(0);
  const [privacyMode, setPrivacyMode] = useState<string>('disabled');

  const providerOptions = listProviderIds().map((id) => ({
    id,
    label: getProviderDefinition(id)?.label ?? id,
  }));

  useEffect(() => {
    fetch('/api/privacy')
      .then((r) => r.json())
      .then((d) => setPrivacyMode(d.privacyMode || 'disabled'))
      .catch(() => {});
  }, []);

  const fetchPrompts = () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      viewMode,
    });
    if (search) params.set('q', search);
    if (providerFilter !== 'all') params.set('provider', providerFilter);
    if (modelFilter) params.set('model', modelFilter);
    if (projectFilter) params.set('project', projectFilter);
    if (dateFrom) params.set('from', new Date(dateFrom).toISOString());
    if (dateTo) params.set('to', new Date(`${dateTo}T23:59:59`).toISOString());

    fetch(`/api/prompts?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setPrompts(d.results || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    const t = setTimeout(fetchPrompts, 300);
    return () => clearTimeout(t);
  }, [search, providerFilter, modelFilter, projectFilter, dateFrom, dateTo, viewMode, offset]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse and search user prompts from scanned sessions
        </p>
      </div>

      {privacyMode === 'disabled' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Privacy mode is disabled — prompt content is not stored by default. Enable preview or full
            mode in <Link href="/settings" className="underline">Settings</Link>.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <input
          type="text"
          placeholder="Optional search…"
          value={search}
          onChange={(e) => {
            setOffset(0);
            setSearch(e.target.value);
          }}
          className="min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
        <select
          value={providerFilter}
          onChange={(e) => {
            setOffset(0);
            setProviderFilter(e.target.value);
          }}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All providers</option>
          {providerOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Model filter"
          value={modelFilter}
          onChange={(e) => {
            setOffset(0);
            setModelFilter(e.target.value);
          }}
          className="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
        <input
          type="text"
          placeholder="Project filter"
          value={projectFilter}
          onChange={(e) => {
            setOffset(0);
            setProjectFilter(e.target.value);
          }}
          className="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setOffset(0);
            setDateFrom(e.target.value);
          }}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setOffset(0);
            setDateTo(e.target.value);
          }}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
        <select
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as typeof viewMode)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="full">Full content</option>
          <option value="preview">Preview</option>
          <option value="hidden">Hidden (stats only)</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : prompts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">No prompts found</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {prompts.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${providerBadge(p.provider)}`}
                  >
                    {providerLabel(p.provider)}
                  </span>
                  {p.model && <span className="font-mono text-muted-foreground">{p.model}</span>}
                  <Link
                    href={`/sessions/${encodeURIComponent(p.sessionId)}`}
                    className="text-primary hover:underline"
                  >
                    View session
                  </Link>
                  <span className="ml-auto text-muted-foreground">{formatDateTime(p.timestamp)}</span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm">{p.contentPreview}</p>
                {p.contentHidden && (
                  <p className="mt-1 text-xs text-muted-foreground italic">
                    Content hidden — stats only
                    {p.supportLevel === 'prompt-history-only' ? ' (prompt-history-only provider)' : ''}
                  </p>
                )}
                {!p.hasReliableTokens && p.noReliableUsageMessage && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {p.noReliableUsageMessage}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  {p.inputTokens != null && <span>In: {formatNumber(p.inputTokens)}</span>}
                  {p.outputTokens != null && <span>Out: {formatNumber(p.outputTokens)}</span>}
                  {p.simulatedCost != null && p.simulatedCost > 0 && (
                    <span>Est. cost: {formatCurrency(p.simulatedCost)}</span>
                  )}
                  {p.projectName && <span className="ml-auto truncate">{p.projectName}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-md border border-input px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">Offset {offset}</span>
            <button
              disabled={prompts.length < PAGE_SIZE}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-md border border-input px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
