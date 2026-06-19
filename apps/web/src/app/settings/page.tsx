'use client';

import { useEffect, useState } from 'react';
import { ScanButton } from '@/components/scan-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type ProviderSetting = {
  id: string;
  label: string;
  defaultPaths: string[];
  enabled: boolean;
  paths: string[];
  supportLevel: string;
};

type SettingsData = {
  privacyMode: string;
  currency: string;
  storeRawRecords: boolean;
  estimatePromptOnlySources: boolean;
  resimulateRecordedCosts: boolean;
  providers: ProviderSetting[];
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = () => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        setSettings(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (extra?: Record<string, unknown>) => {
    if (!settings) return;
    setSaving(true);
    try {
      const providers: Record<string, { enabled: boolean; paths: string[] }> = {};
      for (const p of settings.providers) {
        providers[p.id] = { enabled: p.enabled, paths: p.paths };
      }
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          privacyMode: settings.privacyMode,
          currency: settings.currency,
          storeRawRecords: settings.storeRawRecords,
          estimatePromptOnlySources: settings.estimatePromptOnlySources,
          resimulateRecordedCosts: settings.resimulateRecordedCosts,
          providers,
          ...extra,
        }),
      });
      const data = await res.json();
      setMessage(data.scanResult ? 'Rescan complete' : 'Settings saved');
      setTimeout(() => setMessage(''), 4000);
      load();
    } catch {
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handlePurge = async () => {
    if (!confirm('Permanently delete all stored prompt/response content?')) return;
    await fetch('/api/privacy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ purgeContent: true }),
    });
    setMessage('Content purged');
  };

  if (loading || !settings) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-64 rounded-2xl bg-muted" />
      </div>
    );
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

      <Card>
        <CardHeader>
          <CardTitle>Privacy</CardTitle>
          <CardDescription>Control how much prompt content is stored locally</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={settings.privacyMode}
            onValueChange={(mode) => setSettings({ ...settings, privacyMode: mode })}
          >
            <TabsList>
              {['disabled', 'preview', 'full', 'raw'].map((mode) => (
                <TabsTrigger key={mode} value={mode}>
                  {mode}
                </TabsTrigger>
              ))}
            </TabsList>
            {['disabled', 'preview', 'full', 'raw'].map((mode) => (
              <TabsContent key={mode} value={mode} className="text-sm text-muted-foreground">
                {mode === 'disabled' && 'No prompt content stored.'}
                {mode === 'preview' && 'Store truncated previews only.'}
                {mode === 'full' && 'Store full prompt and response text.'}
                {mode === 'raw' && 'Store raw provider records for debugging.'}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data & display</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <Switch
              id="store-raw"
              checked={settings.storeRawRecords}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, storeRawRecords: checked })
              }
            />
            <Label htmlFor="store-raw">Store raw records (debugging)</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="estimate-prompt"
              checked={settings.estimatePromptOnlySources}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, estimatePromptOnlySources: checked })
              }
            />
            <Label htmlFor="estimate-prompt">Estimate tokens for prompt-only sources</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="resimulate"
              checked={settings.resimulateRecordedCosts}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, resimulateRecordedCosts: checked })
              }
            />
            <Label htmlFor="resimulate">Re-simulate recorded costs</Label>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Currency</Label>
            <Select
              value={settings.currency}
              onValueChange={(currency) => setSettings({ ...settings, currency })}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">USD</SelectItem>
                <SelectItem value="EUR">EUR</SelectItem>
                <SelectItem value="GBP">GBP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Enable or disable scanning per provider. Custom paths override defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {settings.providers.map((p, idx) => (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`provider-${p.id}`}
                    checked={p.enabled}
                    onCheckedChange={(checked) => {
                      const providers = [...settings.providers];
                      providers[idx] = { ...p, enabled: checked };
                      setSettings({ ...settings, providers });
                    }}
                  />
                  <Label htmlFor={`provider-${p.id}`} className="font-medium">
                    {p.label}
                  </Label>
                  <span className="text-xs text-muted-foreground">({p.supportLevel})</span>
                </div>
              </div>
              <p
                className="mt-1 truncate text-[11px] text-muted-foreground"
                title={p.defaultPaths.join(', ')}
              >
                Default: {p.defaultPaths[0] || '—'}
              </p>
              <Input
                type="text"
                placeholder="Custom paths (comma-separated)"
                value={p.paths.join(', ')}
                onChange={(e) => {
                  const providers = [...settings.providers];
                  providers[idx] = {
                    ...p,
                    paths: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  };
                  setSettings({ ...settings, providers });
                }}
                className="mt-2 text-xs"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button onClick={() => save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        <Button variant="outline" onClick={() => save({ rescan: true })} disabled={saving}>
          Force rescan
        </Button>
        <Button variant="outline" onClick={() => save({ rebuildIndexes: true })} disabled={saving}>
          Rebuild rollups
        </Button>
        <Button variant="destructive" onClick={handlePurge}>
          Purge content
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        The web dashboard binds to localhost (127.0.0.1) by default. Run via{' '}
        <code className="rounded bg-muted px-1">pnpm cli dashboard</code> or{' '}
        <code className="rounded bg-muted px-1">pnpm dev</code> — data never leaves your machine.
      </p>
    </div>
  );
}
