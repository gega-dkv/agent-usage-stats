import { useEffect, useState } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { cn } from '@/lib/utils';
import { runningInTauri } from '@/lib/api';

/**
 * Custom window titlebar. Uses Tauri's drag region so the whole bar drags the
 * window. On macOS we reserve space for the native traffic lights (the window
 * is created with `titleBarStyle: overlay` + `decorations: true`); on
 * Windows/Linux (where decorations are disabled at runtime) we render our own
 * minimize/maximize/close controls.
 */
export function Titlebar() {
  const [isMac, setIsMac] = useState<boolean>(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!runningInTauri()) return;
    let cancelled = false;

    // Reliable platform detection via the Rust `get_platform` command.
    invoke<string>('get_platform')
      .then((p) => {
        if (!cancelled) setIsMac(p === 'macos');
      })
      .catch(() => {
        if (!cancelled) setIsMac(/mac/i.test(navigator.platform || ''));
      });

    const appWindow = getCurrentWindow();
    appWindow
      .isMaximized()
      .then((m) => {
        if (!cancelled) setMaximized(m);
      })
      .catch(() => {});
    const unlistenP = appWindow.onResized(() => {
      appWindow.isMaximized().then((m) => {
        if (!cancelled) setMaximized(m);
      });
    });
    return () => {
      cancelled = true;
      void unlistenP.then((u) => u());
    };
  }, []);

  const onMinimize = () => getCurrentWindow().minimize();
  const onMaximize = () => getCurrentWindow().toggleMaximize();
  const onClose = () => getCurrentWindow().close();

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 shrink-0 select-none items-center justify-between border-b border-sidebar-border bg-sidebar px-3"
    >
      {/* Left: macOS traffic-light gutter, otherwise the app title. */}
      <div className="flex items-center gap-2" data-tauri-drag-region>
        {isMac ? (
          // Reserve ~70px for the overlay traffic lights on the left edge.
          <div className="w-[70px]" data-tauri-drag-region aria-hidden />
        ) : (
          <div className="flex items-center gap-1.5" data-tauri-drag-region>
            <div className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-primary to-indigo-500">
              <svg
                className="h-2.5 w-2.5 text-primary-foreground"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M3 3v18h18" />
                <path d="M7 14l4-4 4 4 5-5" />
              </svg>
            </div>
            <span className="text-[11px] font-semibold tracking-tight text-muted-foreground">
              Agent Usage Stats
            </span>
          </div>
        )}
      </div>

      {/* Right: window controls (Windows/Linux only). macOS uses native lights. */}
      {!isMac && runningInTauri() && (
        <div className="flex items-center">
          <TitlebarButton onClick={onMinimize} aria-label="Minimize">
            <Minus className="h-3.5 w-3.5" />
          </TitlebarButton>
          <TitlebarButton onClick={onMaximize} aria-label="Maximize">
            {maximized ? (
              <X className="h-3 w-3 rotate-45" />
            ) : (
              <Square className="h-3 w-3" />
            )}
          </TitlebarButton>
          <TitlebarButton onClick={onClose} aria-label="Close" close>
            <X className="h-3.5 w-3.5" />
          </TitlebarButton>
        </div>
      )}
      {/* Keep the bar symmetric on macOS (spacer mirroring the left gutter). */}
      {isMac && <div className="w-[70px]" data-tauri-drag-region aria-hidden />}
    </div>
  );
}

function TitlebarButton({
  children,
  onClick,
  close,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  close?: boolean;
  'aria-label': string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-sidebar-accent',
        close && 'hover:bg-destructive hover:text-destructive-foreground',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
