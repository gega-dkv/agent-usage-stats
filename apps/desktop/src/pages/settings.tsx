import { useEffect, useState } from 'react';
import { Save, RefreshCw, Database, Trash2, ShieldAlert, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ScanButton } from '@/components/scan-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchJson, postJson } from '@/lib/api';
import { invalidateCache } from '@/lib/use-query';
import { setCurrencyOverride } from '@/lib/format';

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

const PRIVACY_DESC: Record<string, string> = {
  disabled: 'No prompt content stored. Session metadata and token counts only.',
  preview: 'Store truncated previews of prompts and responses.',
  full: 'Store full prompt and response text for browsing.',
  raw: 'Store raw provider records (most detail — for debugging).',
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    fetchJson<SettingsData>('/api/settings')
      .then((d) => setSettings(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (extra?: Record<string, unknown>) => {
    if (!settings) return;
    setSaving(true);
    try {
      const providers: Record<string, { enabled: boolean; paths: string[] }> = {};
      for (const p of settings.providers) {
        providers[p.id] = { enabled: p.enabled, paths: p.paths };
      }
      const data = await postJson<{ error?: string; scanResult?: unknown } & Record<string, unknown>>(
        '/api/settings',
        {
          privacyMode: settings.privacyMode,
          currency: settings.currency,
          storeRawRecords: settings.storeRawRecords,
          estimatePromptOnlySources: settings.estimatePromptOnlySources,
          resimulateRecordedCosts: settings.resimulateRecordedCosts,
          providers,
          ...extra,
        },
      );
      if (data.error) throw new Error(data.error);
      if (settings.currency) setCurrencyOverride(settings.currency);
      invalidateCache('/api/');
      toast.success(data.scanResult ? 'Rescan complete' : 'Settings saved');
      // Re-fetch to reflect server-side changes.
      const fresh = await fetchJson<SettingsData>('/api/settings');
      setSettings(fresh);
    } catch (e) {
      toast.error('Failed to save', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handlePurge = async () => {
    setPurging(true);
    try {
      await postJson('/api/privacy', { purgeContent: true });
      invalidateCache('/api/');
      toast.success('Content purged', { description: 'All stored prompt/response text deleted.' });
      setPurgeOpen(false);
    } catch (e) {
      toast.error('Purge failed', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setPurging(false);
    }
  };

  if (loading || !settings) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Settings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Privacy, currency, providers, and data controls</p>
        </div>
        <ScanButton variant="compact" />
      </div>

      {/* Privacy */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm">Privacy</CardTitle>
          <CardDescription className="text-xs">Control how much prompt content is stored locally</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={settings.privacyMode}
            onValueChange={(mode) => setSettings({ ...settings, privacyMode: mode })}
          >
            <TabsList>
              {['disabled', 'preview', 'full', 'raw'].map((mode) => (
                <TabsTrigger key={mode} value={mode} className="text-xs capitalize">
                  {mode}
                </TabsTrigger>
              ))}
            </TabsList>
            <p className="mt-3 text-xs text-muted-foreground">{PRIVACY_DESC[settings.privacyMode]}</p>
            <TabsContent value={settings.privacyMode} className="hidden" />
          </Tabs>
          {settings.privacyMode === 'disabled' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <p className="text-xs text-warning/90">
                With privacy disabled, the Prompts page won't show content. Enable preview or full mode to browse prompts.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data & display */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm">Data & display</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            id="store-raw"
            label="Store raw records"
            description="Keep raw provider records for debugging."
            checked={settings.storeRawRecords}
            onCheckedChange={(checked) => setSettings({ ...settings, storeRawRecords: checked })}
          />
          <Separator />
          <ToggleRow
            id="estimate-prompt"
            label="Estimate prompt-only sources"
            description="Roughly estimate tokens for prompt-history-only providers (Aider, Cursor)."
            checked={settings.estimatePromptOnlySources}
            onCheckedChange={(checked) => setSettings({ ...settings, estimatePromptOnlySources: checked })}
          />
          <Separator />
          <ToggleRow
            id="resimulate"
            label="Re-simulate recorded costs"
            description="Recompute costs from your pricing table even when the provider recorded a cost."
            checked={settings.resimulateRecordedCosts}
            onCheckedChange={(checked) => setSettings({ ...settings, resimulateRecordedCosts: checked })}
          />
          <Separator />
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Display currency</Label>
              <p className="text-xs text-muted-foreground">Currency used to display estimated costs throughout the app.</p>
            </div>
            <Select
              value={settings.currency}
              onValueChange={(currency) => setSettings({ ...settings, currency })}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Providers */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm">Providers</CardTitle>
          <CardDescription className="text-xs">Enable/disable scanning per provider. Custom paths override defaults.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {settings.providers.map((p, idx) => (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Switch
                    id={`provider-${p.id}`}
                    checked={p.enabled}
                    onCheckedChange={(checked) => {
                      const providers = [...settings.providers];
                      providers[idx] = { ...p, enabled: checked };
                      setSettings({ ...settings, providers });
                    }}
                  />
                  <Label htmlFor={`provider-${p.id}`} className="text-sm font-medium">
                    {p.label}
                  </Label>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {p.supportLevel}
                  </span>
                </div>
              </div>
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground" title={p.defaultPaths.join(', ')}>
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
                    paths: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  };
                  setSettings({ ...settings, providers });
                }}
                className="mt-2 h-8 text-xs"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => save()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </Button>
        <Button variant="outline" onClick={() => save({ rescan: true })} disabled={saving}>
          <RefreshCw className="h-4 w-4" />
          Force rescan
        </Button>
        <Button variant="outline" onClick={() => save({ rebuildIndexes: true })} disabled={saving}>
          <Database className="h-4 w-4" />
          Rebuild rollups
        </Button>
        <Button variant="destructive" onClick={() => setPurgeOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Purge content
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        The desktop app runs a local data server on 127.0.0.1. All processing happens on your machine — data never
        leaves it.
      </p>

      {/* Purge confirm dialog */}
      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Purge all stored content?
            </DialogTitle>
            <DialogDescription>
              This permanently deletes all stored prompt and response text, and clears the search index. Session metadata
              and token counts are preserved. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPurgeOpen(false)} disabled={purging}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handlePurge} disabled={purging}>
              {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Purge everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
