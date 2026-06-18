'use client';

import { useEffect, useState } from 'react';
import { formatCurrency } from '@/lib/format';

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
};

export default function PricingPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<Model>>({});
  const [showAdd, setShowAdd] = useState(false);

  const fetchModels = () => {
    setLoading(true);
    fetch('/api/pricing')
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleEdit = (m: Model) => {
    setEditingId(m.id);
    setEditForm({ ...m });
  };

  const handleSave = async () => {
    if (!editingId) return;
    try {
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
          notes: editForm.notes,
        }),
      });
      setEditingId(null);
      setEditForm({});
      fetchModels();
    } catch (e) {
      console.error(e);
    }
  };

  const handleExport = () => {
    const json = JSON.stringify(models, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pricing.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text);
    await fetch('/api/pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
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
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Import
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
              }}
            />
          </label>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex items-start gap-3">
          <svg className="h-5 w-5 flex-shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Costs are estimates
            </h4>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Costs shown are estimates based on configured API-equivalent pricing. Actual costs may vary based on your subscription, usage tier, or negotiated rates.
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
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
                    No pricing models
                  </td>
                </tr>
              ) : (
                models.map((m) => (
                  <tr key={m.id} className="border-b border-border text-sm last:border-0 transition hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {m.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <div>{m.model}</div>
                      {m.notes && (
                        <div className="text-xs text-muted-foreground">{m.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingId === m.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editForm.inputPerMillion ?? 0}
                          onChange={(e) =>
                            setEditForm({ ...editForm, inputPerMillion: parseFloat(e.target.value) })
                          }
                          className="w-20 rounded border border-input bg-background px-2 py-1 text-right text-xs"
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
                          className="w-20 rounded border border-input bg-background px-2 py-1 text-right text-xs"
                        />
                      ) : (
                        formatCurrency(m.outputPerMillion)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {m.cachedInputPerMillion != null ? formatCurrency(m.cachedInputPerMillion) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {m.reasoningPerMillion != null ? formatCurrency(m.reasoningPerMillion) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === m.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={handleSave}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditForm({});
                            }}
                            className="rounded border border-input bg-background px-2 py-1 text-xs hover:bg-accent"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(m)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
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
