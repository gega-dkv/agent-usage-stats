'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatCurrency, formatDate, formatNumber, providerLabel } from '@/lib/format';

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

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = String(params.id ?? '');
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [conversation, setConversation] = useState<Message[]>([]);
  const [toolCalls, setToolCalls] = useState<Message[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [sessionWarnings, setSessionWarnings] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => r.json())
      .then((data) => {
        setSession(data.session ?? null);
        setConversation(data.conversation ?? data.messages ?? []);
        setToolCalls(data.toolCalls ?? []);
        setWarnings(data.warnings ?? []);
        setSessionWarnings(data.sessionWarnings ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="h-48 animate-pulse rounded-xl bg-muted" />;
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <Link href="/sessions" className="text-sm text-muted-foreground hover:underline">
          ← Back to sessions
        </Link>
        <p>Session not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sessions" className="text-sm text-muted-foreground hover:underline">
          ← Back to sessions
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {session.projectName || session.id}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {providerLabel(session.provider)} · {session.model || 'unknown model'} ·{' '}
          {formatDate(session.updatedAt)} · {formatNumber(session.totalTokens)} tokens ·{' '}
          {formatCurrency(session.estimatedCost)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {session.supportLevel && <span>Support: {session.supportLevel}</span>}
          {session.usageConfidence && <span>Confidence: {session.usageConfidence}</span>}
          {session.costEstimated && <span>Estimated cost</span>}
          {session.tokenUsageEstimated && <span>Estimated tokens</span>}
          {session.pricingSource && <span>Pricing: {session.pricingSource}</span>}
        </div>
      </div>

      {(warnings.length > 0 || sessionWarnings.length > 0) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Parser warnings
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-300">
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
        <h2 className="text-lg font-semibold">Conversation</h2>
        {conversation.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
      </section>

      {toolCalls.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Tool calls</h2>
          {toolCalls.map((message) => (
            <div
              key={message.id}
              className="rounded-xl border border-border bg-muted/30 p-4 font-mono text-sm"
            >
              <div className="mb-2 text-xs text-muted-foreground">
                {message.toolName || message.role} · {formatDate(message.timestamp)}
              </div>
              {message.toolInputPreview && (
                <p className="text-xs">Input: {message.toolInputPreview}</p>
              )}
              {message.toolOutputPreview && (
                <p className="mt-1 text-xs">Output: {message.toolOutputPreview}</p>
              )}
              {!message.toolInputPreview && !message.toolOutputPreview && (
                <p>{message.contentPreview || '—'}</p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{message.role}</span>
        <span>{formatDate(message.timestamp)}</span>
      </div>
      <p className="text-sm text-foreground">{message.contentPreview || '—'}</p>
      {(message.inputTokens || message.outputTokens) && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          in {formatNumber(message.inputTokens ?? 0)} · out {formatNumber(message.outputTokens ?? 0)}
        </p>
      )}
    </div>
  );
}
