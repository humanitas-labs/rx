import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';

import { registerCommand, sendEvent } from '@/ipc';

const startedAt = Date.now();

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1236,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is a sandboxed web application: no Node, no filesystem,
      // no raw IPC (ADR-002 §3). Do not weaken these.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on('ready-to-show', () => window.show());

  if (process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

void app.whenReady().then(() => {
  registerCommand('app.status', () => ({
    version: app.getVersion(),
    platform: process.platform,
    startedAt,
  }));

  const window = createWindow();

  const heartbeat = setInterval(() => {
    sendEvent(window, 'app.heartbeat', { at: Date.now(), uptimeMs: Date.now() - startedAt });
  }, 5_000);
  window.on('closed', () => clearInterval(heartbeat));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
