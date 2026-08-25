// Root: capability-gated routing (plan step 7). Content never loads before
// permissions pass; onboarding polls so granting access flips to the shell
// without a relaunch.

import { useEffect, useState } from 'react';

import type { CapabilitiesView } from '@rx/contract';

import { Onboarding } from '@/features/onboarding/Onboarding';
import { Shell } from '@/features/shell/Shell';

const RECHECK_MS = 2_000;

export function App() {
  const [capabilities, setCapabilities] = useState<CapabilitiesView | null>(null);
  const [checkTick, setCheckTick] = useState(0);

  const usable =
    capabilities !== null && capabilities.database === 'ok' && capabilities.missingTables.length === 0;

  useEffect(() => {
    void window.rx.invoke('app.capabilities', {}).then(setCapabilities);
  }, [checkTick]);

  // Poll while blocked so a granted permission is noticed automatically.
  useEffect(() => {
    if (usable || capabilities === null) {
      return;
    }
    const timer = window.setInterval(() => setCheckTick((t) => t + 1), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, [usable, capabilities]);

  if (capabilities === null) {
    return <div className="placeholder" style={{ height: '100vh' }} />;
  }
  if (!usable) {
    return <Onboarding capabilities={capabilities} onRecheck={() => setCheckTick((t) => t + 1)} />;
  }
  return <Shell />;
}
