// The IPC contract between the Electron main process and the renderer.
//
// Every command and event that crosses the preload boundary is declared here
// with a zod schema for both directions. Main validates inbound payloads
// before handling and outbound payloads before sending; preload validates
// again on the renderer side (ADR-002 §3). Nothing outside this package may
// define an IPC channel.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Decoded message bodies (ADR-003)
//
// Span offsets are UTF-16 code units — JavaScript string indexing and Apple's
// native attributed-string range encoding.

export const spanKindSchema = z.enum(['link', 'mention', 'bold', 'italic', 'other']);

export const spanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  kind: spanKindSchema,
  value: z.string().optional(),
});

export const decodedBodySchema = z.object({
  text: z.string(),
  spans: z.array(spanSchema),
});

export type SpanKind = z.infer<typeof spanKindSchema>;
export type Span = z.infer<typeof spanSchema>;
export type DecodedBody = z.infer<typeof decodedBodySchema>;

// ---------------------------------------------------------------------------
// Commands: renderer → main, request/response.

export const appStatusRequestSchema = z.object({});

export const appStatusResponseSchema = z.object({
  version: z.string(),
  platform: z.string(),
  startedAt: z.number().int(),
});

export type AppStatusResponse = z.infer<typeof appStatusResponseSchema>;

export const commands = {
  'app.status': {
    request: appStatusRequestSchema,
    response: appStatusResponseSchema,
  },
} as const;

export type CommandName = keyof typeof commands;

export type CommandRequest<C extends CommandName> = z.infer<(typeof commands)[C]['request']>;
export type CommandResponse<C extends CommandName> = z.infer<(typeof commands)[C]['response']>;

// ---------------------------------------------------------------------------
// Events: main → renderer, one-way push.

export const heartbeatEventSchema = z.object({
  at: z.number().int(),
  uptimeMs: z.number().nonnegative(),
});

export type HeartbeatEvent = z.infer<typeof heartbeatEventSchema>;

export const events = {
  'app.heartbeat': heartbeatEventSchema,
} as const;

export type EventName = keyof typeof events;

export type EventPayload<E extends EventName> = z.infer<(typeof events)[E]>;

// ---------------------------------------------------------------------------
// The API surface preload exposes to the renderer as `window.rx`.

export interface RxApi {
  invoke<C extends CommandName>(command: C, request: CommandRequest<C>): Promise<CommandResponse<C>>;
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
}
