'use client';

import { useEffect, useState } from 'react';
import { ScanButton } from '@/components/scan-button';

export default function SettingsPage() {
  const [privacyMode, setPrivacyMode] = useState('disabled');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/privacy')
      .then((r) => r.json())
      .then((d) => {
        setPrivacyMode(d.privacyMode || 'disabled');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacyMode }),
      });
      setMessage('Privacy settings saved');
      setTimeout(() => setMessage(''), 3000);
    } catch (e) {
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handlePurge = async () => {
    if (!confirm('Permanently delete all stored prompt/response content? This cannot be undone.'))
      return;
    try {
      await fetch('/api/privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purgeContent: true }),
      });
      setMessage('Content purged');
      setTimeout(() => setMessage(''), 3000);
    } catch (e) {
      setMessage('Error purging content');
    }
  };

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-muted" />
      <div className="h-64 rounded-2xl bg-muted" />
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure privacy, providers, and storage
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">{message}</span>
          )}
          <ScanButton variant="compact" />
        </div>
      </div>

      {/* Privacy */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Privacy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Control what session content is stored locally
        </p>

        <div className="mt-6 space-y-3">
          {[
            {
              value: 'disabled',
              label: 'Disabled',
              desc: 'No prompt or response content. Only token counts and metadata.',
              recommended: true,
            },
            {
              value: 'preview',
              label: 'Preview',
              desc: 'Store short redacted previews only.',
            },
            {
              value: 'full',
              label: 'Full',
              desc: 'Store full prompt and response content.',
            },
            {
              value: 'raw',
              label: 'Raw',
              desc: 'Store full raw session records (debugging).',
            },
          ].map((opt) => {
            const selected = privacyMode === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-background hover:bg-accent/50'
                }`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value={opt.value}
                  checked={selected}
                  onChange={(e) => setPrivacyMode(e.target.value)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{opt.label}</span>
                    {opt.recommended && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{opt.desc}</p>
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save privacy mode'}
          </button>
          <button
            onClick={handlePurge}
            className="rounded-lg border border-destructive px-4 py-2 text-sm font-medium text-destructive transition hover:bg-destructive hover:text-destructive-foreground"
          >
            Purge stored content
          </button>
        </div>
      </div>

      {/* Database */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Database</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Local SQLite database location
        </p>
        <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
          <code className="font-mono text-xs">~/.config/agent-usage-stats/stats.db</code>
        </div>
      </div>

      {/* CLI commands */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">CLI commands</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage from the command line
        </p>
        <div className="mt-4 space-y-2">
          {[
            { cmd: 'pnpm cli sync', desc: 'Detect installed agents and sync sessions' },
            { cmd: 'pnpm cli sync --agent codex', desc: 'Sync only Codex sessions' },
            { cmd: 'pnpm cli stats', desc: 'View usage statistics' },
            { cmd: 'pnpm cli doctor', desc: 'Run health check' },
            { cmd: 'pnpm cli privacy set full', desc: 'Enable full prompt storage' },
            { cmd: 'pnpm cli privacy purge-content', desc: 'Purge stored content' },
          ].map((item) => (
            <div
              key={item.cmd}
              className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <code className="font-mono text-xs">{item.cmd}</code>
              <span className="text-xs text-muted-foreground">{item.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
