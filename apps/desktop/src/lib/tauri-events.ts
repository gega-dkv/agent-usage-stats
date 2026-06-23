import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { runningInTauri } from '@/lib/api';

/**
 * Bridge between Tauri backend events and the SPA.
 *
 * Tauri's `emit()` delivers events to JS only via the `@tauri-apps/api/event`
 * `listen()` API — it does NOT dispatch on the DOM `window` bus. So anything
 * in the SPA using `window.addEventListener(...)` can't hear Rust events.
 *
 * This hook subscribes to the Rust events we emit (menu/tray actions, sidecar
 * readiness) and re-dispatches them as ordinary window events that the rest of
 * the app already listens for:
 *
 *   Rust `native-menu` → window `native-menu` (detail = payload string)
 *   Rust `app-ready`   → window `app-ready`
 *   Rust `native-rescan`→ window `native-rescan` (detail = body string)
 *
 * In a plain browser (no Tauri) this is a no-op.
 */
export function useTauriEventBridge(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !runningInTauri()) return;
    const unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    const attach = async () => {
      if (cancelled) return;

      const nativeMenu = await listen<string>('native-menu', (e) => {
        window.dispatchEvent(new CustomEvent('native-menu', { detail: e.payload }));
      });
      if (cancelled) {
        nativeMenu();
        return;
      }
      unlisteners.push(nativeMenu);

      const appReady = await listen<unknown>('app-ready', () => {
        window.dispatchEvent(new Event('app-ready'));
      });
      if (cancelled) {
        appReady();
        return;
      }
      unlisteners.push(appReady);

      const nativeRescan = await listen<string>('native-rescan', (e) => {
        window.dispatchEvent(new CustomEvent('native-rescan', { detail: e.payload }));
      });
      if (cancelled) {
        nativeRescan();
        return;
      }
      unlisteners.push(nativeRescan);
    };

    attach();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [enabled]);
}
