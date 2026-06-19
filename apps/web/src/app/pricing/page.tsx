'use client';

import { useEffect, useState } from 'react';
import { formatCurrency, formatDateTime } from '@/lib/format';

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

const PROFILES = [
  'api-standard',
  'api-batch',
  'subscription-equivalent',
  'custom',
];

export default function PricingPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profile, setProfile] = useState('api-standard');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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

  const fetchModels = () => {
    setLoading(true);
    fetch(`/api/pricing?profile=${encodeURIComponent(profile)}`)
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models || []);
        setProfiles(d.profiles?.length ? d.profiles : PROFILES);
        setLastUpdated(d.lastUpdated ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchModels();
  }, [profile]);

  const handleEdit = (m: Model) => {
    setEditingId(m.id);
    setEditForm({ ...m });
  };

  const handleSave = async () => {
    if (!editingId) return;
    await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: editForm.provider,
        model: editForm.model,
        inputPerMillion: editForm.inputPerMillion,
        outputPerMillion: editForm.outputPerMillion,
        cachedInputPerMillion: editForm.cachedInputPerMillion,
        cacheWritePerMillion: editForm.cacheWritePerMillion,
        reasoningPerMillion: editForm.reasoningPerMillion,
        profile,
        notes: editForm.notes,
      }),
    });
    setEditingId(null);
    setEditForm({});
    fetchModels();
  };

  const handleAdd = async () => {
    if (!newModel.model) return;
    await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newModel, profile }),
    });
    setShowAdd(false);
    setNewModel({ provider: 'openai', model: '', inputPerMillion: 0, outputPerMillion: 0 });
    fetchModels();
  };

  const handleClone = async () => {
    if (!cloneTarget) return;
    await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clone',
        sourceProfile: profile,
        targetProfile: cloneTarget,
      }),
    });
    setCloneTarget('');
    fetchModels();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edit model pricing to match your actual usage tier
          </p>
          {lastUpdated && (
            <p className="mt-1 text-xs text-muted-foreground">
              Last updated: {formatDateTime(lastUpdated)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            {[...new Set([...PROFILES, ...profiles])].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Add model
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-card p-4">
        <div>
          <label className="text-xs text-muted-foreground">Clone profile to</label>
          <input
            value={cloneTarget}
            onChange={(e) => setCloneTarget(e.target.value)}
            placeholder="new-profile-name"
            className="mt-1 block rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={handleClone}
          disabled={!cloneTarget}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Clone current profile
        </button>
      </div>

      {showAdd && (
        <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
          <h3 className="font-semibold">Add custom model</h3>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Provider (openai, anthropic…)"
              value={newModel.provider}
              onChange={(e) => setNewModel({ ...newModel, provider: e.target.value })}
              className="rounded-md border border-input px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Model name"
              value={newModel.model}
              onChange={(e) => setNewModel({ ...newModel, model: e.target.value })}
              className="rounded-md border border-input px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="Input/M"
              value={newModel.inputPerMillion}
              onChange={(e) =>
                setNewModel({ ...newModel, inputPerMillion: parseFloat(e.target.value) })
              }
              className="w-24 rounded-md border border-input px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="Output/M"
              value={newModel.outputPerMillion}
              onChange={(e) =>
                setNewModel({ ...newModel, outputPerMillion: parseFloat(e.target.value) })
              }
              className="w-24 rounded-md border border-input px-2 py-1.5 text-sm"
            />
            <button onClick={handleAdd} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Save
            </button>
            <button onClick={() => setShowAdd(false)} className="rounded-md border px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border bg-muted/30">
              <tr className="text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Input/M</th>
                <th className="px-4 py-3 text-right">Output/M</th>
                <th className="px-4 py-3 text-right">Cached/M</th>
                <th className="px-4 py-3 text-right">Reasoning/M</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : models.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                    No pricing models for this profile
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.id} className="border-b border-border text-sm last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{m.provider}</td>
                    <td className="px-4 py-3 font-medium">{m.model}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingId === m.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.inputPerMillion ?? 0}
                          onChange={(e) =>
                            setEditForm({ ...editForm, inputPerMillion: parseFloat(e.target.value) })
                          }
                          className="w-20 rounded border px-2 py-1 text-right text-xs"
                        />
                      ) : (
                        formatCurrency(m.inputPerMillion)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingId === m.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.outputPerMillion ?? 0}
                          onChange={(e) =>
                            setEditForm({ ...editForm, outputPerMillion: parseFloat(e.target.value) })
                          }
                          className="w-20 rounded border px-2 py-1 text-right text-xs"
                        />
                      ) : (
                        formatCurrency(m.outputPerMillion)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingId === m.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.cachedInputPerMillion ?? ''}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              cachedInputPerMillion: parseFloat(e.target.value) || undefined,
                            })
                          }
                          className="w-20 rounded border px-2 py-1 text-right text-xs"
                        />
                      ) : m.cachedInputPerMillion != null ? (
                        formatCurrency(m.cachedInputPerMillion)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingId === m.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.reasoningPerMillion ?? ''}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              reasoningPerMillion: parseFloat(e.target.value) || undefined,
                            })
                          }
                          className="w-20 rounded border px-2 py-1 text-right text-xs"
                        />
                      ) : m.reasoningPerMillion != null ? (
                        formatCurrency(m.reasoningPerMillion)
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === m.id ? (
                        <div className="flex justify-end gap-1">
                          <button onClick={handleSave} className="rounded bg-emerald-600 px-2 py-1 text-xs text-white">
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditForm({});
                            }}
                            className="rounded border px-2 py-1 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => handleEdit(m)} className="text-xs text-primary hover:underline">
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
