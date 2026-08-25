// The only bridge between the renderer and the main process. Exposes named,
// schema-validated methods — never ipcRenderer itself (ADR-002 §3).

import { contextBridge, ipcRenderer } from 'electron';

import {
  commands,
  events,
  type CommandName,
  type CommandRequest,
  type CommandResponse,
  type EventName,
  type EventPayload,
  type RxApi,
} from '@rx/contract';

async function invoke<C extends CommandName>(
  command: C,
  request: CommandRequest<C>,
): Promise<CommandResponse<C>> {
  if (!(command in commands)) {
    throw new Error(`unknown command: ${String(command)}`);
  }
  const parsedRequest = commands[command].request.safeParse(request);
  if (!parsedRequest.success) {
    throw new Error(`invalid request for ${command}: ${parsedRequest.error.message}`);
  }
  const response: unknown = await ipcRenderer.invoke(command, parsedRequest.data);
  const parsedResponse = commands[command].response.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(`invalid response for ${command}: ${parsedResponse.error.message}`);
  }
  return parsedResponse.data as CommandResponse<C>;
}

function on<E extends EventName>(
  event: E,
  listener: (payload: EventPayload<E>) => void,
): () => void {
  if (!(event in events)) {
    throw new Error(`unknown event: ${String(event)}`);
  }
  const wrapped = (_e: Electron.IpcRendererEvent, rawPayload: unknown) => {
    const parsed = events[event].safeParse(rawPayload);
    if (parsed.success) {
      listener(parsed.data as EventPayload<E>);
    }
  };
  ipcRenderer.on(event, wrapped);
  return () => ipcRenderer.removeListener(event, wrapped);
}

const api: RxApi = { invoke, on };

contextBridge.exposeInMainWorld('rx', api);
