import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { CommandPalette } from '@/components/command-palette';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from 'sonner';
import { fetchJson } from '@/lib/api';
import { setCurrencyOverride } from '@/lib/format';
import { triggerGlobalRescan } from '@/components/scan-button';
import { toggleThemeGlobally } from '@/components/theme-toggle';

type SettingsResponse = { config?: { currency?: string } };

const SIDEBAR_KEY = 'agent-usage:sidebar';

/**
 * Global app shell: custom titlebar + sidebar + topbar + command palette + toaster.
 * Owns the ⌘K hotkey, sidebar collapse/open state, currency priming, and the
 * native menu event bridge (rescan / theme / preferences).
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
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        <Sidebar
          collapsed={collapsed}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          onToggleCollapsed={toggleSidebar}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar
            onOpenCommand={() => setCommandOpen(true)}
            onToggleSidebar={toggleSidebar}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          />
          <main className="mx-auto w-full max-w-[1400px] flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <Toaster position="bottom-right" richColors closeButton />
    </TooltipProvider>
  );
}

/** Listen for events emitted by the native (Rust) menu bar and tray. */
export function useNativeMenuEvents(onPreferences?: () => void) {
  useEffect(() => {
    const handler = async (e: Event) => {
      const payload = (e as CustomEvent<string>).detail;
      switch (payload) {
        case 'menu://rescan':
          await triggerGlobalRescan();
          break;
        case 'menu://toggle-theme':
          toggleThemeGlobally();
          break;
        case 'menu://preferences':
          onPreferences?.();
          break;
        // menu://reload is handled by the Tauri webview reload itself.
      }
    };
    window.addEventListener('native-menu', handler as EventListener);
    return () => window.removeEventListener('native-menu', handler as EventListener);
  }, [onPreferences]);
}
