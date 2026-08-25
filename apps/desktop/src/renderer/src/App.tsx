import { useEffect, useState } from 'react';

import type { AppStatusResponse, HeartbeatEvent } from '@rx/contract';

// Placeholder shell proving the typed IPC contract end to end: one command
// (app.status) and one event (app.heartbeat). Replaced by the real interface
// from plan step 6 onward.
export function App() {
  const [status, setStatus] = useState<AppStatusResponse | null>(null);
  const [heartbeat, setHeartbeat] = useState<HeartbeatEvent | null>(null);

  useEffect(() => {
    void window.rx.invoke('app.status', {}).then(setStatus);
    return window.rx.on('app.heartbeat', setHeartbeat);
  }, []);

  return (
    <main
      style={{
        fontFamily: '-apple-system, system-ui, sans-serif',
        display: 'grid',
        placeItems: 'center',
        minHeight: '100vh',
        margin: 0,
        background: '#111',
        color: '#eee',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>rx</h1>
        <p>
          {status
            ? `v${status.version} on ${status.platform}`
            : 'waiting for main process…'}
        </p>
        <p style={{ color: '#888' }}>
          {heartbeat
            ? `heartbeat: up ${Math.round(heartbeat.uptimeMs / 1000)}s`
            : 'no heartbeat yet'}
        </p>
      </div>
    </main>
  );
}
