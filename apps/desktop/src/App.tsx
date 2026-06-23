import { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { AppShell, useNativeMenuEvents } from '@/components/app-shell';
import { BootScreen } from '@/components/boot-screen';
import { Titlebar } from '@/components/titlebar';
import { useAutoScanOnLaunch } from '@/lib/use-auto-scan';
import { useTauriEventBridge } from '@/lib/tauri-events';

import DashboardPage from '@/pages/dashboard';
import SessionsPage from '@/pages/sessions';
import SessionDetailPage from '@/pages/session-detail';
import PromptsPage from '@/pages/prompts';
import ProvidersPage from '@/pages/providers';
import PricingPage from '@/pages/pricing';
import SettingsPage from '@/pages/settings';

/**
 * Top-level app: native titlebar above either the boot screen (until the
 * sidecar is reachable) or the full SPA shell.
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  // Bridge native menu events (rescan/theme/preferences) to the SPA.
  useNativeMenuEvents(() => navigate('/settings'));

  // Forward Tauri backend events to the window event bus the SPA listens on.
  useTauriEventBridge(true);

  // Auto-scan once shortly after the dashboard mounts so charts are fresh.
  useAutoScanOnLaunch(ready);

  return (
    <div className="flex h-screen flex-col">
      <Titlebar />
      {!ready ? (
        <BootScreen onReady={() => setReady(true)} />
      ) : (
        <AppShell>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/sessions/:id" element={<SessionDetailPage />} />
            <Route path="/prompts" element={<PromptsPage />} />
            <Route path="/providers" element={<ProvidersPage />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Routes>
        </AppShell>
      )}
    </div>
  );
}
