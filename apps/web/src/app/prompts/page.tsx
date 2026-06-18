'use client';

import { useEffect, useState } from 'react';
import { formatNumber, formatDateTime, providerLabel, providerBadge } from '@/lib/format';

type Prompt = {
  id: string;
  sessionId: string;
  timestamp: string;
  role: string;
  model: string | null;
  contentPreview: string;
  inputTokens: number | null;
  outputTokens: number | null;
  provider: string;
  projectName: string | null;
};

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [privacyMode, setPrivacyMode] = useState<string>('disabled');

  useEffect(() => {
    fetch('/api/privacy')
      .then((r) => r.json())
      .then((d) => setPrivacyMode(d.privacyMode || 'disabled'))
      .catch(() => {});
  }, []);

  const fetchPrompts = () => {
    if (!search) {
      setPrompts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ q: search, limit: '100' });
    if (providerFilter !== 'all') params.set('provider', providerFilter);
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
  }, [search, providerFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search across all user prompts from your scanned sessions
        </p>
      </div>

      {/* Privacy notice */}
      {privacyMode === 'disabled' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Privacy mode: disabled
              </h4>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                Prompt content is not stored by default. Enable preview or full mode in{' '}
                <a href="/settings" className="underline">
                  Settings
                </a>{' '}
                to view full prompts.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-1 items-center gap-2">
          <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search prompt text (e.g. 'refactor auth')…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded-md border-0 bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-0"
            autoFocus
          />
        </div>
        <div className="h-6 w-px bg-border" />
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All providers</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="gemini">Gemini</option>
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : !search ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </div>
          <h3 className="mt-4 font-semibold">Search your prompts</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Type to search across all user prompts
          </p>
        </div>
      ) : prompts.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No prompts found for &ldquo;{search}&rdquo;
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {prompts.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${providerBadge(
                    p.provider,
                  )}`}
                >
                  {providerLabel(p.provider)}
                </span>
                <span className="text-muted-foreground">{p.role}</span>
                {p.model && (
                  <span className="font-mono text-muted-foreground">{p.model}</span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {formatDateTime(p.timestamp)}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-sm">{p.contentPreview}</p>
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                {p.inputTokens != null && (
                  <span>
                    <span className="font-medium">In:</span> {formatNumber(p.inputTokens)}
                  </span>
                )}
                {p.outputTokens != null && (
                  <span>
                    <span className="font-medium">Out:</span> {formatNumber(p.outputTokens)}
                  </span>
                )}
                {p.projectName && (
                  <span className="ml-auto truncate">📁 {p.projectName}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
