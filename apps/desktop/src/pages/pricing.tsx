import { Suspense, useState } from 'react';
import { Plus, Copy, Check, X, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, mutateCache, invalidateCache } from '@/lib/use-query';
import { fetchJson, postJson } from '@/lib/api';
import { useUrlFilters } from '@/lib/use-filters';
import { formatCurrency, formatRelativeTime } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

type Model = {
  id: number;
  provider: string;
  model: string;
  currency: string;
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number | null;
  cacheWritePerMillion: number | null;
  reasoningPerMillion: number | null;
  profile: string;
  notes: string | null;
  updatedAt?: string;
};

type PricingResponse = { models: Model[]; profiles: string[]; lastUpdated?: string };

const DEFAULT_PROFILES = ['api-standard', 'subscription-equivalent', 'custom'];
const NUMBER_STEP = 0.01;

export default function PricingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <PricingContent />
    </Suspense>
  );
}

function PricingContent() {
  const { filters, setFilter } = useUrlFilters({ profile: 'api-standard' });
  const profile = filters.profile;

  const key = `/api/pricing?profile=${encodeURIComponent(profile)}`;
  const { data, loading, mutate } = useQuery<PricingResponse>(key, {
    fetcher: (k) => fetchJson(k),
  });

  const models = data?.models ?? [];
  const profiles = Array.from(new Set([...DEFAULT_PROFILES, ...(data?.profiles ?? [])]));

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Model>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newModel, setNewModel] = useState({
    provider: 'openai',
    model: '',
    inputPerMillion: 0,
    outputPerMillion: 0,
  });
  const [cloneTarget, setCloneTarget] = useState('');
  const [saving, setSaving] = useState(false);

  const handleEdit = (m: Model) => {
    setEditingId(m.id);
    setEditForm({ ...m });
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await postJson('/api/pricing', {
        provider: editForm.provider,
        model: editForm.model,
        inputPerMillion: editForm.inputPerMillion,
        outputPerMillion: editForm.outputPerMillion,
        cachedInputPerMillion: editForm.cachedInputPerMillion,
        cacheWritePerMillion: editForm.cacheWritePerMillion,
        reasoningPerMillion: editForm.reasoningPerMillion,
        profile,
        notes: editForm.notes,
      });
      setEditingId(null);
      setEditForm({});
      await mutate();
      invalidateCache('/api/stats');
      toast.success('Pricing updated', { description: `${editForm.provider}/${editForm.model}` });
    } catch (e) {
      toast.error('Failed to save', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newModel.model) return;
    setSaving(true);
    try {
      await postJson('/api/pricing', { ...newModel, profile });
      setShowAdd(false);
      setNewModel({ provider: 'openai', model: '', inputPerMillion: 0, outputPerMillion: 0 });
      await mutate();
      invalidateCache('/api/stats');
      toast.success('Model added', { description: newModel.model });
    } catch (e) {
      toast.error('Failed to add', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    if (!cloneTarget) return;
    setSaving(true);
    try {
      await postJson('/api/pricing', { action: 'clone', sourceProfile: profile, targetProfile: cloneTarget });
      setCloneTarget('');
      mutateCache(key, undefined);
      toast.success('Profile cloned', { description: `${profile} → ${cloneTarget}` });
    } catch (e) {
      toast.error('Failed to clone', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Pricing</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Per-million token rates used to estimate costs
            {data?.lastUpdated && <> · updated {formatRelativeTime(data.lastUpdated)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={profile} onValueChange={(v) => setFilter('profile', v)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setShowAdd((v) => !v)} variant={showAdd ? 'secondary' : 'default'}>
            <Plus className="h-4 w-4" />
            {showAdd ? 'Cancel' : 'Add model'}
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Clone profile to</Label>
            <Input
              value={cloneTarget}
              onChange={(e) => setCloneTarget(e.target.value)}
              placeholder="new-profile-name"
              className="w-[200px]"
            />
          </div>
          <Button onClick={handleClone} disabled={!cloneTarget || saving} variant="outline">
            <Copy className="h-4 w-4" />
            Clone current
          </Button>
        </div>
      </Card>

      {showAdd && (
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Add custom model</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Provider</Label>
              <Input
                placeholder="openai, anthropic…"
                value={newModel.provider}
                onChange={(e) => setNewModel({ ...newModel, provider: e.target.value })}
                className="w-[160px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Model name</Label>
              <Input
                placeholder="e.g. gpt-4o"
                value={newModel.model}
                onChange={(e) => setNewModel({ ...newModel, model: e.target.value })}
                className="w-[180px]"
              />
            </div>
            <NumberField
              label="Input/M"
              value={newModel.inputPerMillion}
              onChange={(v) => setNewModel({ ...newModel, inputPerMillion: v })}
            />
            <NumberField
              label="Output/M"
              value={newModel.outputPerMillion}
              onChange={(v) => setNewModel({ ...newModel, outputPerMillion: v })}
            />
            <div className="flex gap-2">
              <Button onClick={handleAdd} disabled={saving || !newModel.model}>
                <Check className="h-4 w-4" /> Save
              </Button>
              <Button onClick={() => setShowAdd(false)} variant="ghost">
                <X className="h-4 w-4" /> Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Provider</TableHead>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input/M</TableHead>
                <TableHead className="text-right">Output/M</TableHead>
                <TableHead className="text-right">Cached/M</TableHead>
                <TableHead className="text-right">Reasoning/M</TableHead>
                <TableHead className="pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : models.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-10 text-center text-sm text-muted-foreground">
                    No pricing models for this profile
                  </TableCell>
                </TableRow>
              ) : (
                models.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="pl-5 font-mono text-xs text-muted-foreground">{m.provider}</TableCell>
                    <TableCell className="font-medium">{m.model}</TableCell>
                    <TableCell className="text-right font-mono text-xs nums">
                      {editingId === m.id ? (
                        <InlineNumber
                          value={editForm.inputPerMillion ?? 0}
                          onChange={(v) => setEditForm({ ...editForm, inputPerMillion: v })}
                        />
                      ) : (
                        formatCurrency(m.inputPerMillion)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs nums">
                      {editingId === m.id ? (
                        <InlineNumber
                          value={editForm.outputPerMillion ?? 0}
                          onChange={(v) => setEditForm({ ...editForm, outputPerMillion: v })}
                        />
                      ) : (
                        formatCurrency(m.outputPerMillion)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs nums">
                      {editingId === m.id ? (
                        <InlineNumber
                          value={editForm.cachedInputPerMillion}
                          onChange={(v) => setEditForm({ ...editForm, cachedInputPerMillion: v })}
                        />
                      ) : m.cachedInputPerMillion != null ? (
                        formatCurrency(m.cachedInputPerMillion)
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs nums">
                      {editingId === m.id ? (
                        <InlineNumber
                          value={editForm.reasoningPerMillion}
                          onChange={(v) => setEditForm({ ...editForm, reasoningPerMillion: v })}
                        />
                      ) : m.reasoningPerMillion != null ? (
                        formatCurrency(m.reasoningPerMillion)
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="pr-5 text-right">
                      {editingId === m.id ? (
                        <div className="flex justify-end gap-1">
                          <Button size="xs" onClick={handleSave} disabled={saving}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              setEditingId(null);
                              setEditForm({});
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="xs" variant="ghost" onClick={() => handleEdit(m)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function InlineNumber({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <Input
      type="number"
      step={NUMBER_STEP}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
      className="ml-auto h-7 w-20 text-right text-xs"
    />
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={NUMBER_STEP}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-[110px]"
      />
    </div>
  );
}
