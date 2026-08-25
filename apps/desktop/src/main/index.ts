import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, net, protocol, shell } from 'electron';

import { createDecoder } from '@rx/apple-body-decoder';
import { ATTACHMENT_PROTOCOL } from '@rx/contract';
import { openWorkflowStore } from '@rx/core';
import decoderWasmPath from '../../../../packages/apple-body-decoder/dist/decoder.wasm?asset';

import { createCommands } from '@/app/commands';
import {
  attachmentPathByGuid,
  checkCapabilities,
  defaultMessagesDatabasePath,
  openMessagesDatabase,
} from '@/apple-messages';
import { registerCommand, registerCommands, sendEvent } from '@/ipc';

// One name in dev and packaged builds so userData — and the workflow
// database under it — resolves to the same place (~/Library/Application
// Support/rx) either way.
app.setName('rx');

// Attachment bytes reach the renderer over a custom read-only scheme
// resolved by GUID in main (plan step 9) — local files are served in place,
// never copied into rx storage, and never by renderer-supplied path.
protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_PROTOCOL, privileges: { standard: true, stream: true } },
]);

const startedAt = Date.now();

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1236,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Frameless with custom-positioned traffic lights (frame 48-2191:
    // lights at 16,16 on a #141414 window).
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#141414',
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

void app.whenReady().then(async () => {
  registerCommand('app.status', () => ({
    version: app.getVersion(),
    platform: process.platform,
    startedAt,
  }));

  registerCommand('app.openPermissionSettings', ({ pane }) => {
    const url =
      pane === 'full-disk-access'
        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
        : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';
    void shell.openExternal(url);
    return {};
  });

  const messagesDbPath = defaultMessagesDatabasePath();
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });

  // The reader opens lazily so access granted while rx is running (onboarding
  // polls capabilities) starts working without a relaunch.
  let reader: ReturnType<typeof openMessagesDatabase> | null = null;
  const services = {
    get reader() {
      if (reader === null) {
        const capabilities = checkCapabilities(messagesDbPath);
        if (capabilities.database === 'ok' && capabilities.missingTables.length === 0) {
          reader = openMessagesDatabase(messagesDbPath);
        }
      }
      return reader;
    },
    decoder: await createDecoder(readFileSync(decoderWasmPath)),
    store: openWorkflowStore(join(userData, 'workflow.db')),
    messagesDbPath,
  };
  registerCommands(createCommands(services));

  protocol.handle(ATTACHMENT_PROTOCOL, (request) => {
    // attachmentUrl(): rx-attachment://attachment/<encoded guid>
    const guid = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    const reader = services.reader;
    const resolved = reader === null ? null : attachmentPathByGuid(reader, guid);
    if (resolved === null) {
      return new Response(null, { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved.path).toString());
  });

  // Best effort: direct chats deep-link to the handle; groups have no public
  // URL, so just bring Messages.app forward.
  registerCommand('conversation.openInMessages', ({ chatGuid }) => {
    const direct = /^(iMessage|SMS);-;(.+)$/.exec(chatGuid);
    if (direct?.[2] !== undefined) {
      const scheme = direct[1] === 'SMS' ? 'sms' : 'imessage';
      void shell.openExternal(`${scheme}://${encodeURIComponent(direct[2])}`);
    } else {
      void shell.openPath('/System/Applications/Messages.app');
    }
    return {};
  });

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
