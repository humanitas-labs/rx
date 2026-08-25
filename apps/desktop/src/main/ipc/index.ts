import { ipcMain, type BrowserWindow } from 'electron';

import type { CommandName, EventName, EventPayload } from '@rx/contract';

import { guardCommand, guardEvent, type CommandHandler } from '@/ipc/registry';

export function registerCommand<C extends CommandName>(command: C, handler: CommandHandler<C>) {
  const guarded = guardCommand(command, handler);
  ipcMain.handle(command, (_event, rawRequest: unknown) => guarded(rawRequest));
}

export function sendEvent<E extends EventName>(
  window: BrowserWindow,
  event: E,
  payload: EventPayload<E>,
) {
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(event, guardEvent(event, payload));
}
