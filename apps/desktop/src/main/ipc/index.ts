import { ipcMain, type BrowserWindow } from 'electron';

import type { CommandName, EventName, EventPayload } from '@rx/contract';

import type { CommandHandlers } from '@/app/commands';
import { guardCommand, guardEvent, type CommandHandler } from '@/ipc/registry';

export function registerCommand<C extends CommandName>(command: C, handler: CommandHandler<C>) {
  const guarded = guardCommand(command, handler);
  ipcMain.handle(command, (_event, rawRequest: unknown) => guarded(rawRequest));
}

export function registerCommands(handlers: CommandHandlers): void {
  for (const [command, handler] of Object.entries(handlers) as [
    CommandName,
    CommandHandler<CommandName>,
  ][]) {
    registerCommand(command, handler);
  }
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
