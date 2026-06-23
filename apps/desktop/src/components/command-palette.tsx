import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  LayoutDashboard,
  MessageSquare,
  Tags,
  Boxes,
  Settings as SettingsIcon,
  Search as SearchIcon,
  RefreshCw,
  Moon,
  CornerDownRight,
} from 'lucide-react';
import { ProviderBadge } from '@/components/provider-badge';
import { fetchJson } from '@/lib/api';
import { triggerGlobalRescan } from '@/components/scan-button';
import { toggleThemeGlobally } from '@/components/theme-toggle';

type SessionHit = {
  id: string;
  provider: string;
  projectName?: string;
  model?: string;
};

type PromptHit = {
  sessionId?: string;
  provider: string;
  model?: string;
  preview: string;
};

const PAGES = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Navigation' },
  { href: '/sessions', label: 'Sessions', icon: MessageSquare, group: 'Navigation' },
  { href: '/prompts', label: 'Prompts', icon: Tags, group: 'Navigation' },
  { href: '/providers', label: 'Providers', icon: Boxes, group: 'Navigation' },
  { href: '/pricing', label: 'Pricing', icon: Tags, group: 'Navigation' },
  { href: '/settings', label: 'Settings', icon: SettingsIcon, group: 'Navigation' },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<SessionHit[]>([]);
  const [prompts, setPrompts] = useState<PromptHit[]>([]);

  // Reset query each time it opens.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  // Debounced search for sessions + prompts.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    const handle = setTimeout(async () => {
      try {
        const [sessData, promptData] = await Promise.all([
          fetchJson<{ sessions?: SessionHit[] }>('/api/sessions?limit=8&orderBy=date'),
          q.length > 1
            ? fetchJson<{ results?: PromptHit[] }>(
                `/api/prompts?q=${encodeURIComponent(q)}&limit=5&viewMode=preview`,
              )
            : Promise.resolve({ results: [] }),
        ]);
        setSessions(sessData.sessions ?? []);
        setPrompts(promptData.results ?? []);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  const go = useCallback(
    (href: string) => {
      onOpenChange(false);
      navigate(href);
    },
    [navigate, onOpenChange],
  );

  const runSync = useCallback(async () => {
    onOpenChange(false);
    await triggerGlobalRescan();
  }, [onOpenChange]);

  const toggleTheme = useCallback(() => {
    onOpenChange(false);
    toggleThemeGlobally();
  }, [onOpenChange]);

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions.slice(0, 5);
    return sessions
      .filter(
        (s) =>
          s.projectName?.toLowerCase().includes(q) ||
          s.provider.toLowerCase().includes(q) ||
          s.model?.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [sessions, query]);

  const hasQuery = query.trim().length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, sessions, prompts…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {PAGES.filter(
            (p) => !hasQuery || p.label.toLowerCase().includes(query.trim().toLowerCase()),
          ).map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem key={page.href} value={`${page.label} navigation page`} onSelect={() => go(page.href)}>
                <Icon className="text-muted-foreground" />
                <span>{page.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {filteredSessions.length > 0 && (
          <CommandGroup heading={hasQuery ? 'Matching sessions' : 'Recent sessions'}>
            {filteredSessions.map((s) => (
              <CommandItem
                key={s.id}
                value={`session ${s.projectName ?? ''} ${s.provider} ${s.model ?? ''} ${s.id}`}
                onSelect={() => go(`/sessions/${encodeURIComponent(s.id)}`)}
              >
                <CornerDownRight className="text-muted-foreground" />
                <span className="truncate">{s.projectName || s.id.slice(0, 10)}</span>
                <ProviderBadge provider={s.provider} className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {prompts.length > 0 && (
          <CommandGroup heading="Prompts">
            {prompts.map((p, i) => (
              <CommandItem
                key={`${p.sessionId ?? ''}-${i}`}
                value={`prompt ${p.preview} ${p.provider} ${p.model ?? ''}`}
                onSelect={() => p.sessionId && go(`/sessions/${encodeURIComponent(p.sessionId)}`)}
              >
                <SearchIcon className="text-muted-foreground" />
                <span className="truncate">{p.preview}</span>
                <ProviderBadge provider={p.provider} className="ml-auto" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="run sync rescan import" onSelect={runSync}>
            <RefreshCw className="text-muted-foreground" />
            <span>Run sync</span>
          </CommandItem>
          <CommandItem value="toggle theme dark light mode" onSelect={toggleTheme}>
            <Moon className="text-muted-foreground" />
            <span>Toggle theme</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
