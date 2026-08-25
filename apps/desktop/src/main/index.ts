import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, net, powerMonitor, protocol, shell } from 'electron';

import { createDecoder } from '@rx/apple-body-decoder';
import { createContactsBridge, createHelperLoader } from '@rx/apple-contacts';
import { ATTACHMENT_PROTOCOL, AVATAR_PROTOCOL } from '@rx/contract';
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
import { startRuntime } from '@/runtime/runtime';

// One name in dev and packaged builds so userData — and the workflow
// database under it — resolves to the same place (~/Library/Application
// Support/rx) either way.
app.setName('rx');

// Attachment bytes reach the renderer over a custom read-only scheme
// resolved by GUID in main (plan step 9) — local files are served in place,
// never copied into rx storage, and never by renderer-supplied path.
protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_PROTOCOL, privileges: { standard: true, stream: true } },
  { scheme: AVATAR_PROTOCOL, privileges: { standard: true, stream: true } },
]);

const startedAt = Date.now();

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1236,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Frameless with custom-positioned traffic lights (frame 48-2191).
    // Under-window vibrancy (iss-0021): desktop shows through a dark wash.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'active',
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
    // Contacts via the spawned rx-contacts helper (ADR-005). The bridge
    // never blocks reads; until the snapshot loads, raw handles render.
    contacts: createContactsBridge(
      createHelperLoader(
        app.isPackaged
          ? join(process.resourcesPath, 'rx-contacts')
          : join(app.getAppPath(), 'build', 'rx-contacts'),
      ),
    ),
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

  protocol.handle(AVATAR_PROTOCOL, async (request) => {
    // avatarUrl(): rx-avatar://avatar/<encoded handle>
    const handle = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    // The first paint outruns the address-book load by seconds. Waiting here
    // keeps that a slow image rather than a 404 the renderer would treat as
    // "no photo" for the rest of the session.
    await services.contacts.ready;
    const photo = services.contacts.photo(handle);
    if (photo === null) {
      return new Response(null, { status: 404 });
    }
    // Cacheable for the process lifetime: the snapshot loads once, and a
    // changed address book arrives with the next launch. Without this every
    // view switch re-requests every visible avatar, and the aborted requests
    // that causes are what made photos flicker back to initials.
    return new Response(photo, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400, immutable' },
    });
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

  // Background lifecycle (plan step 11): live source observation, resurface
  // persistence, snooze wake pass — with a wake pass on system resume so
  // due snoozes surface the moment the lid opens.
  const runtime = startRuntime({
    getReader: () => services.reader,
    dbPath: messagesDbPath,
    store: services.store,
    emit: (event, payload) => sendEvent(window, event, payload),
  });
  powerMonitor.on('resume', () => runtime.wakePass());

  // Once the contacts snapshot lands, refresh views so names replace the
  // handles that rendered while it loaded.
  void services.contacts.ready.then(() =>
    sendEvent(window, 'conversations.changed', { chatGuids: [] }),
  );

  window.on('closed', () => {
    clearInterval(heartbeat);
    runtime.stop();
  });

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
