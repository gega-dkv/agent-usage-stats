import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProviderBadge } from '@/components/provider-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber, formatCurrency, formatRelativeTime } from '@/lib/format';
import type { SessionRow } from './types';

export function SessionTable({ title, sessions }: { title: string; sessions: SessionRow[] }) {
  if (!sessions.length) return null;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <Link to="/sessions" className="text-xs font-medium text-primary hover:underline">
          View all →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Project</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="pr-5 text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id} className="group">
                <TableCell className="pl-5">
                  <Link
                    to={`/sessions/${encodeURIComponent(s.id)}`}
                    className="block max-w-[200px] truncate font-medium text-foreground hover:text-primary"
                    title={s.projectName || s.id}
                  >
                    {s.projectName || s.id.slice(0, 10)}
                  </Link>
                  {s.updatedAt && (
                    <span className="text-[11px] text-muted-foreground">{formatRelativeTime(s.updatedAt)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <ProviderBadge provider={s.provider} />
                </TableCell>
                <TableCell className="text-right font-mono text-xs nums text-muted-foreground">
                  {formatNumber(s.totalTokens)}
                </TableCell>
                <TableCell className="pr-5 text-right font-mono text-xs nums font-medium">
                  {formatCurrency(s.estimatedCost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
