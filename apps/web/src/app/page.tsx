import { Suspense } from 'react';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { Skeleton } from '@/components/ui/skeleton';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  // useSearchParams (via useUrlFilters) requires a Suspense boundary for static prerender.
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <DashboardClient />
    </Suspense>
  );
}
