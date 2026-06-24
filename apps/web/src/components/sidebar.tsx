'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  Boxes,
  Tags,
  Settings as SettingsIcon,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScanButton } from '@/components/scan-button';
import { useQuery } from '@/lib/use-query';
import { fetchJson } from '@/lib/fetcher';
import { formatRelativeTime } from '@/lib/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type ScanStatus = { latestScan?: { completedAt?: string; status?: string; sessionsFound?: number } };

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Explore',
    items: [
      { href: '/sessions', label: 'Sessions', icon: MessageSquare },
      { href: '/prompts', label: 'Prompts', icon: Tags },
    ],
  },
  {
    label: 'Configure',
    items: [
      { href: '/providers', label: 'Providers', icon: Boxes },
      { href: '/pricing', label: 'Pricing', icon: Tags },
      { href: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

export function Sidebar({
  collapsed,
  mobileOpen,
  onMobileClose,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();

  const { data: scan } = useQuery<ScanStatus>('scan-status', {
    fetcher: () => fetchJson('/api/scan'),
  });

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onMobileClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 ease-in-out',
          // Desktop: part of flex layout via margin trick on main content.
          collapsed ? 'md:w-[60px]' : 'md:w-60',
          'md:sticky md:top-0 md:h-screen md:shrink-0 md:translate-x-0',
          // Mobile: slide-in drawer.
          mobileOpen ? 'w-64 translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5" onClick={onMobileClose}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-indigo-500 text-primary-foreground shadow-sm">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 4 4 5-5" />
              </svg>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold leading-none">Agent Usage</div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Stats
                </div>
              </div>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-5">
              {!collapsed && (
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  const link = (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onMobileClose}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                        collapsed && 'justify-center',
                        active
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                      )}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                          aria-hidden
                        />
                      )}
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                  if (collapsed) {
                    return (
                      <Tooltip key={item.href}>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    );
                  }
                  return link;
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer: sync status + collapse */}
        <div className="border-t border-sidebar-border p-2">
          {!collapsed && (
            <div className="mb-2 px-1">
              <SyncStatusFooter scan={scan} />
            </div>
          )}
          <div className={cn('flex items-center', collapsed ? 'justify-center' : 'justify-between gap-1')}>
            {!collapsed && (
              <div className="flex-1">
                <ScanButton variant="compact" />
              </div>
            )}
            <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapsed} />
          </div>
        </div>
      </aside>
    </>
  );
}

function SyncStatusFooter({ scan }: { scan?: ScanStatus }) {
  const latest = scan?.latestScan;
  return (
    <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/50 px-2 py-1.5 text-[11px] text-muted-foreground">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          latest?.status === 'failed' ? 'bg-destructive' : 'bg-success',
        )}
        aria-hidden
      />
      <span className="truncate">
        {latest ? (
          <>
            Synced {latest.sessionsFound ?? 0} sessions · {formatRelativeTime(latest.completedAt)}
          </>
        ) : (
          'Not synced yet'
        )}
      </span>
    </div>
  );
}

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeft : PanelLeftClose;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{collapsed ? 'Expand' : 'Collapse'}</TooltipContent>
    </Tooltip>
  );
}
