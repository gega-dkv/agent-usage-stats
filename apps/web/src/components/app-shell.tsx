'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { CommandPalette } from '@/components/command-palette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import { fetchJson } from '@/lib/fetcher';
import { setCurrencyOverride } from '@/lib/format';

type SettingsResponse = { config?: { currency?: string } };

const SIDEBAR_KEY = 'agent-usage:sidebar';

/**
 * Global app shell: sidebar + topbar + command palette + toaster.
 * Owns the ⌘K hotkey, sidebar collapse/open state, and currency priming.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Hydrate collapse state from localStorage once on mount.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ⌘K / Ctrl+K to toggle the command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Prime the configured currency so formatCurrency respects it everywhere.
  useEffect(() => {
    let cancelled = false;
    fetchJson<SettingsResponse>('/api/settings')
      .then((s) => {
        if (cancelled) return;
        if (s.config?.currency) setCurrencyOverride(s.config.currency);
      })
      .catch(() => {
        /* ignore — defaults to USD */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          onToggleCollapsed={toggleSidebar}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onOpenCommand={() => setCommandOpen(true)}
            onToggleSidebar={toggleSidebar}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          <footer className="border-t border-border bg-muted/20 py-4">
            <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
              <p className="text-center text-xs text-muted-foreground">
                All data stays on your machine · No telemetry ·{' '}
                <a
                  href="https://github.com/gega-dkv/agent-usage-stats"
                  className="hover:text-foreground hover:underline"
                >
                  GitHub
                </a>
              </p>
            </div>
          </footer>
        </div>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}
