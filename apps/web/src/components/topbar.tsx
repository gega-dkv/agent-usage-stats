'use client';

import { usePathname } from 'next/navigation';
import { Menu, Search, PanelLeft } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';

const TITLES: Record<string, { title: string; description: string }> = {
  '/': { title: 'Dashboard', description: 'Local-first view of your AI session usage and costs' },
  '/sessions': { title: 'Sessions', description: 'Browse and inspect individual agent sessions' },
  '/prompts': { title: 'Prompts', description: 'Search prompts you have sent to agents' },
  '/providers': { title: 'Providers', description: 'Detected agents and their support levels' },
  '/pricing': { title: 'Pricing', description: 'Per-million token rates used for cost estimates' },
  '/settings': { title: 'Settings', description: 'Privacy, currency, providers, and data controls' },
};

function resolveTitle(pathname: string): { title: string; description: string } {
  if (pathname.startsWith('/sessions/')) return { title: 'Session detail', description: 'Conversation and tool calls' };
  for (const key of Object.keys(TITLES)) {
    if (key === '/' ? pathname === '/' : pathname.startsWith(key)) return TITLES[key];
  }
  return { title: 'Agent Usage', description: '' };
}

export function Topbar({
  onOpenCommand,
  onToggleSidebar,
  onOpenMobileSidebar,
}: {
  onOpenCommand: () => void;
  onToggleSidebar: () => void;
  onOpenMobileSidebar: () => void;
}) {
  const pathname = usePathname();
  const { title, description } = resolveTitle(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border glass-header px-4 sm:px-6">
      {/* Mobile sidebar toggle */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={onOpenMobileSidebar}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Desktop sidebar toggle */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="hidden md:inline-flex"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      {/* Title */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>

      {/* Command palette trigger */}
      <button
        onClick={onOpenCommand}
        className="hidden items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="sm:hidden"
        onClick={onOpenCommand}
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </Button>

      <ThemeToggle />
    </header>
  );
}
