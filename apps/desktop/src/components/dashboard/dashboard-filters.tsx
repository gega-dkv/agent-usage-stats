import { listProviderIds, getProviderDefinition } from '@agent-usage/shared';
import { useMemo } from 'react';
import { RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CONFIDENCE_OPTIONS, type DashboardFilters } from './types';
import type { GroupBy, Granularity, Metric, TimeRange } from '@/lib/stats-params';

const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
  { value: 'month', label: '30d' },
  { value: 'year', label: '12m' },
  { value: 'custom', label: 'Custom' },
];

export function DashboardFiltersBar({
  filters,
  onChange,
  onReset,
  isDirty,
}: {
  filters: DashboardFilters;
  onChange: <K extends keyof DashboardFilters>(key: K, value: DashboardFilters[K]) => void;
  onReset: () => void;
  isDirty: boolean;
}) {
  const providerOptions = useMemo(
    () =>
      listProviderIds().map((id) => ({
        id,
        label: getProviderDefinition(id)?.label ?? id,
      })),
    [],
  );

  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-end gap-3">
        {/* Segmented time range */}
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Range</Label>
          <div className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5">
            {RANGE_OPTIONS.map((opt) => {
              const active = filters.range === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange('range', opt.value)}
                  className={cn(
                    'rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={active}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {filters.range === 'custom' && (
          <>
            <FilterField label="From">
              <Input
                type="date"
                value={filters.customFrom}
                onChange={(e) => onChange('customFrom', e.target.value)}
                className="w-[150px]"
              />
            </FilterField>
            <FilterField label="To">
              <Input
                type="date"
                value={filters.customTo}
                onChange={(e) => onChange('customTo', e.target.value)}
                className="w-[150px]"
              />
            </FilterField>
          </>
        )}

        <FilterSelect
          label="Granularity"
          value={filters.granularity}
          onChange={(v) => onChange('granularity', v as Granularity)}
        >
          <SelectItem value="day">Day</SelectItem>
          <SelectItem value="week">Week</SelectItem>
          <SelectItem value="month">Month</SelectItem>
          <SelectItem value="year">Year</SelectItem>
        </FilterSelect>

        <FilterSelect label="Group by" value={filters.groupBy} onChange={(v) => onChange('groupBy', v as GroupBy)}>
          <SelectItem value="provider">Provider</SelectItem>
          <SelectItem value="model">Model</SelectItem>
          <SelectItem value="project">Project</SelectItem>
          <SelectItem value="role">Role</SelectItem>
        </FilterSelect>

        <FilterSelect label="Metric" value={filters.metric} onChange={(v) => onChange('metric', v as Metric)}>
          <SelectItem value="tokens">Tokens</SelectItem>
          <SelectItem value="input">Input</SelectItem>
          <SelectItem value="output">Output</SelectItem>
          <SelectItem value="cached">Cached</SelectItem>
          <SelectItem value="reasoning">Reasoning</SelectItem>
          <SelectItem value="cost">Cost</SelectItem>
          <SelectItem value="prompts">Prompts</SelectItem>
          <SelectItem value="sessions">Sessions</SelectItem>
        </FilterSelect>

        <FilterSelect
          label="Provider"
          value={filters.provider}
          onChange={(v) => onChange('provider', v)}
          width="w-[160px]"
        >
          <SelectItem value="all">All providers</SelectItem>
          {providerOptions.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Confidence"
          value={filters.usageConfidence}
          onChange={(v) => onChange('usageConfidence', v)}
          width="w-[180px]"
        >
          {CONFIDENCE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </FilterSelect>

        {isDirty && (
          <Button variant="ghost" size="sm" onClick={onReset} className="mb-0.5 text-muted-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}
      </div>
    </Card>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
  width = 'w-[140px]',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <FilterField label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={width}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </FilterField>
  );
}
