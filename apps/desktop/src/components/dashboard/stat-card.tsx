import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sparkline } from './sparkline';

type StatCardProps = {
  label: string;
  value: string;
  subValue?: string;
  icon: ReactNode;
  gradient: string;
  accent?: string;
  spark?: number[];
  trend?: { value: string; positive: boolean };
};

export function StatCard({ label, value, subValue, icon, gradient, accent, spark, trend }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:shadow-popover">
      <div
        className={cn('absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-[0.12] transition-opacity group-hover:opacity-[0.22]', gradient)}
        aria-hidden
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div
            className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm', gradient)}
          >
            {icon}
          </div>
          {trend && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                trend.positive ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
              )}
              title={`Change vs previous period: ${trend.value}`}
            >
              {trend.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {trend.value}
            </span>
          )}
        </div>
        <p className="mt-3.5 text-xs font-medium text-muted-foreground">{label}</p>
        <div className="mt-0.5 flex items-end justify-between gap-2">
          <p className="truncate text-xl font-bold tracking-tight nums text-foreground">{value}</p>
          {spark && spark.length > 1 && (
            <Sparkline data={spark} color={accent ?? 'hsl(var(--primary))'} width={72} height={24} />
          )}
        </div>
        {subValue && <p className="mt-1 truncate text-[11px] text-muted-foreground">{subValue}</p>}
      </div>
    </div>
  );
}
