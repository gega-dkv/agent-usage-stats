'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, User, Bot, Wrench, AlertTriangle, Terminal } from 'lucide-react';
import { useQuery } from '@/lib/use-query';
import { fetchJson } from '@/lib/fetcher';
import { formatCurrency, formatDate, formatNumber, formatRelativeTime } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfidenceBadge, ProviderBadge } from '@/components/provider-badge';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Message = {
  id: string;
  role: string;
  timestamp?: string;
  contentPreview: string;
  inputTokens?: number;
  outputTokens?: number;
  toolName?: string;
  toolInputPreview?: string;
  toolOutputPreview?: string;
};

type Warning = {
  file: string;
  line?: number;
  message: string;
  severity: string;
  code?: string;
};

type SessionDetail = {
  id: string;
  provider: string;
  projectName?: string;
  model?: string;
  updatedAt?: string;
  totalTokens: number;
  estimatedCost: number;
  supportLevel?: string;
  usageConfidence?: string;
  costEstimated?: boolean;
  tokenUsageEstimated?: boolean;
  pricingSource?: string;
  sessionWarnings?: string;
};

type SessionDetailResponse = {
  session?: SessionDetail;
  conversation?: Message[];
  messages?: Message[];
  toolCalls?: Message[];
  warnings?: Warning[];
  sessionWarnings?: unknown[];
};

const ROLE_META: Record<string, { icon: typeof User; label: string; color: string }> = {
  user: { icon: User, label: 'User', color: 'bg-primary/15 text-primary' },
  assistant: { icon: Bot, label: 'Assistant', color: 'bg-success/15 text-success' },
  system: { icon: Terminal, label: 'System', color: 'bg-muted text-muted-foreground' },
  tool: { icon: Wrench, label: 'Tool', color: 'bg-info/15 text-info' },
};

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = String(params.id ?? '');

  const { data, loading } = useQuery<SessionDetailResponse>(
    sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}` : null,
    { fetcher: (key) => fetchJson(key) },
  );

  const session = data?.session ?? null;
  const conversation = data?.conversation ?? data?.messages ?? [];
  const toolCalls = data?.toolCalls ?? [];
  const warnings = data?.warnings ?? [];
  const sessionWarnings = data?.sessionWarnings ?? [];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <Link href="/sessions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sessions
        </Link>
        <Card className="border-dashed">
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-medium">Session not found</p>
            <p className="mt-1 text-xs text-muted-foreground">This session may have been removed.</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sessions" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to sessions
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight">
              {session.projectName || session.id.slice(0, 12)}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ProviderBadge provider={session.provider} />
              <span className="font-mono">{session.model || 'unknown model'}</span>
              <span>·</span>
              <span title={formatDate(session.updatedAt)}>{formatRelativeTime(session.updatedAt)}</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="text-lg font-bold nums">{formatCurrency(session.estimatedCost)}</span>
            <span className="text-xs text-muted-foreground">{formatNumber(session.totalTokens)} tokens</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {session.usageConfidence && <ConfidenceBadge confidence={session.usageConfidence} />}
          {session.costEstimated && (
            <Badge variant="warning" className="text-[10px]">est. cost</Badge>
          )}
          {session.tokenUsageEstimated && (
            <Badge variant="warning" className="text-[10px]">est. tokens</Badge>
          )}
          {session.pricingSource && (
            <Badge variant="soft" className="text-[10px]">pricing: {session.pricingSource}</Badge>
          )}
        </div>
      </div>

      {(warnings.length > 0 || sessionWarnings.length > 0) && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" />
            Parser warnings ({warnings.length + sessionWarnings.length})
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-warning/80">
            {sessionWarnings.map((w, i) => (
              <li key={`sw-${i}`}>
                {typeof w === 'object' && w !== null && 'message' in w
                  ? String((w as { message: string }).message)
                  : String(w)}
              </li>
            ))}
            {warnings.map((w) => (
              <li key={w.file + w.message}>
                [{w.severity}] {w.message}
                {w.code ? ` (${w.code})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Conversation
          </h2>
          <span className="text-xs text-muted-foreground">{conversation.length} messages</span>
        </div>
        <div className="space-y-2.5">
          {conversation.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-xs text-muted-foreground">
                No conversation messages recorded.
              </CardContent>
            </Card>
          ) : (
            conversation.map((message) => <MessageCard key={message.id} message={message} />)
          )}
        </div>
      </section>

      {toolCalls.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Tool calls</h2>
            <span className="text-xs text-muted-foreground">{toolCalls.length} calls</span>
          </div>
          <div className="space-y-2.5">
            {toolCalls.map((message) => (
              <ToolCallCard key={message.id} message={message} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  const meta = ROLE_META[message.role] ?? ROLE_META.unknown ?? { icon: Bot, label: message.role, color: 'bg-muted text-muted-foreground' };
  const Icon = meta.icon;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', meta.color)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-medium uppercase tracking-wider">{meta.label}</span>
        </div>
        {message.timestamp && (
          <span className="text-[11px] text-muted-foreground" title={formatDate(message.timestamp)}>
            {formatRelativeTime(message.timestamp)}
          </span>
        )}
      </div>
      <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {message.contentPreview || '—'}
      </p>
      {(message.inputTokens || message.outputTokens) && (
        <div className="mt-2.5 flex gap-3 font-mono text-[11px] text-muted-foreground">
          {message.inputTokens ? <span>↓ {formatNumber(message.inputTokens)}</span> : null}
          {message.outputTokens ? <span>↑ {formatNumber(message.outputTokens)}</span> : null}
        </div>
      )}
    </Card>
  );
}

function ToolCallCard({ message }: { message: Message }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
        <Wrench className="h-3.5 w-3.5 text-info" />
        <span className="font-mono text-xs font-medium">{message.toolName || message.role}</span>
        {message.timestamp && (
          <span className="ml-auto text-[11px] text-muted-foreground">{formatDate(message.timestamp)}</span>
        )}
      </div>
      <div className="space-y-2 p-4">
        {message.toolInputPreview && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Input</p>
            <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-xs">
              {message.toolInputPreview}
            </pre>
          </div>
        )}
        {message.toolOutputPreview && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Output</p>
            <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-xs">
              {message.toolOutputPreview}
            </pre>
          </div>
        )}
        {!message.toolInputPreview && !message.toolOutputPreview && (
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
            {message.contentPreview || '—'}
          </pre>
        )}
      </div>
    </Card>
  );
}
