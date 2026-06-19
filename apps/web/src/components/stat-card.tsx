import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';

type StatCardProps = {
  label: string;
  value: string;
  subValue?: string;
  icon: ReactNode;
  gradient: string;
  trend?: { value: string; positive: boolean };
};

export function StatCard({ label, value, subValue, icon, gradient, trend }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:shadow-md">
      <div
        className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${gradient} opacity-10 transition group-hover:opacity-20`}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm`}
          >
            {icon}
          </div>
          {trend && (
            <Badge variant={trend.positive ? 'secondary' : 'destructive'}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </Badge>
          )}
        </div>
        <p className="mt-4 text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
        {subValue && <p className="mt-1 text-xs text-muted-foreground">{subValue}</p>}
      </div>
    </div>
  );
}
