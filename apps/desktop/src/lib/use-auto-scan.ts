import { useEffect } from 'react';
import { runningInTauri } from '@/lib/api';
import { triggerGlobalRescan } from '@/components/scan-button';

/**
 * Auto-scan once shortly after the sidecar is ready — keeps charts fresh on
 * launch without requiring a manual sync. Runs exactly once per app process and
 * respects the `app-ready` event the Rust side emits after the sidecar is
 * healthy.
 */
export function useAutoScanOnLaunch(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fire = async () => {
      if (cancelled) return;
      try {
        await triggerGlobalRescan();
      } catch {
        /* toast already handled */
      }
    };
    // Small delay so the initial dashboard render isn't blocked.
    const t = setTimeout(fire, 1500);
    const onReady = () => fire();
    if (runningInTauri()) {
      window.addEventListener('app-ready', onReady as EventListener);
    }
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener('app-ready', onReady as EventListener);
    };
  }, [enabled]);
}
