// Command and event plumbing with both-directions schema validation
// (ADR-002 §3). Kept free of Electron imports so the validation behavior is
// unit-testable; index.ts binds these to ipcMain and webContents.

import {
  commands,
  events,
  type CommandName,
  type CommandRequest,
  type CommandResponse,
  type EventName,
  type EventPayload,
} from '@rx/contract';

export type CommandHandler<C extends CommandName> = (
  request: CommandRequest<C>,
) => Promise<CommandResponse<C>> | CommandResponse<C>;

/**
 * Wrap a command implementation so the raw IPC payload is validated before
 * the handler runs and the response is validated before it is returned.
 */
export function guardCommand<C extends CommandName>(command: C, handler: CommandHandler<C>) {
  const schema = commands[command];
  return async (rawRequest: unknown): Promise<CommandResponse<C>> => {
    const request = schema.request.safeParse(rawRequest);
    if (!request.success) {
      throw new Error(`invalid request for ${command}: ${request.error.message}`);
    }
    const response = await handler(request.data as CommandRequest<C>);
    const validated = schema.response.safeParse(response);
    if (!validated.success) {
      throw new Error(`invalid response from ${command}: ${validated.error.message}`);
    }
    return validated.data as CommandResponse<C>;
  };
}

/**
 * Validate an outbound event payload before it is sent to any renderer.
 * Throws on contract violations: a malformed event is a main-process bug.
 */
export function guardEvent<E extends EventName>(event: E, payload: EventPayload<E>) {
  const validated = events[event].safeParse(payload);
  if (!validated.success) {
    throw new Error(`invalid payload for event ${event}: ${validated.error.message}`);
  }
  return validated.data as EventPayload<E>;
}
