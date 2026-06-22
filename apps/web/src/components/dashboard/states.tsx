'use client';

import { Sparkles, DatabaseZap } from 'lucide-react';
import { ScanButton } from '@/components/scan-button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function DashboardEmptyState() {
  return (
    <Card className="border-dashed bg-card/50">
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-indigo-500 text-primary-foreground shadow-sm">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">No sessions yet</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Run a sync to import session data from your installed AI coding agents. All processing happens locally —
          nothing leaves your machine.
        </p>
        <div className="mt-5">
          <ScanButton />
        </div>
      </div>
    </Card>
  );
}

export function DashboardLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="mt-3.5 h-3 w-20" />
            <Skeleton className="mt-2 h-5 w-28" />
            <Skeleton className="mt-2 h-3 w-32" />
          </Card>
        ))}
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-[240px] w-full" />
        </Card>
        <Card className="p-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-[240px] w-full" />
        </Card>
      </div>
      {/* Tables row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-4 w-32" />
            <div className="mt-4 flex flex-col gap-2">
              {Array.from({ length: 5 }).map((__, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DashboardError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <div className="flex items-start gap-3 p-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <DatabaseZap className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-destructive">Couldn’t load the dashboard</h3>
          <p className="mt-0.5 break-words text-sm text-destructive/80">{message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Try running <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">agent-usage sync</code> from
            the CLI, or check that your database is accessible.
          </p>
        </div>
      </div>
    </Card>
  );
}
