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
// Conversation views (plan step 6)
//
// What the renderer sees: source summary joined with rx workflow state and
// Space assignment. Watermark internals never cross this boundary.

export const workflowStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inbox') }),
  z.object({ kind: z.literal('archived') }),
  z.object({ kind: z.literal('snoozed'), wakeAt: z.number().int() }),
]);

export const conversationViewSchema = z.object({
  chatGuid: z.string(),
  displayName: z.string().nullable(),
  participantHandles: z.array(z.string()),
  isGroup: z.boolean(),
  lastActivityAtMs: z.number(),
  /** rx unread: a source inbound exists past the rx seen watermark. */
  unread: z.boolean(),
  /** Messages.app's own unread count, shown for reference only. */
  sourceUnreadCount: z.number().int().nonnegative(),
  state: workflowStateSchema,
  /** Space assignment; null is Unassigned (spec §3.6). */
  spaceId: z.number().int().nullable(),
  /** One-line preview of the latest message; null when nothing previews. */
  previewText: z.string().nullable(),
});

export const spaceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  position: z.number().int().nonnegative(),
});

/** Which conversations a list is scoped to: All, Unassigned, or one Space. */
export const spaceScopeSchema = z.union([z.enum(['all', 'unassigned']), z.number().int()]);

export const listViewSchema = z.enum(['inbox', 'snoozed', 'archived']);

export type WorkflowStateView = z.infer<typeof workflowStateSchema>;
export type ConversationView = z.infer<typeof conversationViewSchema>;
export type SpaceView = z.infer<typeof spaceSchema>;
export type SpaceScope = z.infer<typeof spaceScopeSchema>;
export type ListView = z.infer<typeof listViewSchema>;

// ---------------------------------------------------------------------------
// Thread items (plan step 4 classification, renderer-facing shape)

export const messageBaseSchema = z.object({
  guid: z.string(),
  rowId: z.number().int(),
  isFromMe: z.boolean(),
  senderHandle: z.string().nullable(),
  sentAtMs: z.number(),
});

export const attachmentViewSchema = z.object({
  guid: z.string(),
  transferName: z.string().nullable(),
  mimeType: z.string().nullable(),
  totalBytes: z.number().int().nonnegative(),
  /** The file exists locally; absolute paths never cross this boundary. */
  present: z.boolean(),
});

export type AttachmentView = z.infer<typeof attachmentViewSchema>;

/**
 * Custom protocol serving locally present attachment bytes to the renderer
 * (plan step 9). Main resolves the GUID back to the local file — nothing is
 * copied into rx storage.
 */
export const ATTACHMENT_PROTOCOL = 'rx-attachment';

export function attachmentUrl(guid: string): string {
  return `${ATTACHMENT_PROTOCOL}://attachment/${encodeURIComponent(guid)}`;
}

export const messageItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    base: messageBaseSchema,
    text: z.string(),
    spans: z.array(spanSchema),
    editedAtMs: z.number().nullable(),
    hasAttachments: z.boolean(),
    attachments: z.array(attachmentViewSchema),
    /** GUID of the message this replies to; null for top-level messages. */
    replyToGuid: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('tapback'),
    base: messageBaseSchema,
    tapbackType: z.number().int(),
    added: z.boolean(),
    targetMessageGuid: z.string().nullable(),
    /** Custom-emoji reactions carry the emoji itself. */
    emoji: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('group-event'),
    base: messageBaseSchema,
    itemType: z.number().int(),
    groupTitle: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('unsupported'),
    base: messageBaseSchema,
    reason: z.enum(['balloon-app', 'undecodable-body', 'empty']),
    balloonBundleId: z.string().nullable(),
    hasAttachments: z.boolean(),
    attachments: z.array(attachmentViewSchema),
  }),
]);

export type MessageItemView = z.infer<typeof messageItemSchema>;

// ---------------------------------------------------------------------------
// Capabilities

export const capabilitiesSchema = z.object({
  database: z.enum(['ok', 'not-found', 'permission-denied', 'unreadable']),
  missingTables: z.array(z.string()),
  messagesAppPresent: z.boolean(),
});

export type CapabilitiesView = z.infer<typeof capabilitiesSchema>;

// ---------------------------------------------------------------------------
// Space command outcomes: expected failures are data, not thrown errors.

export const spaceErrorSchema = z.enum(['space-not-found', 'duplicate-space-name']);

const spaceOutcome = <T extends z.ZodType>(ok: T) =>
  z.union([z.object({ ok }), z.object({ err: spaceErrorSchema })]);

// ---------------------------------------------------------------------------
// Commands: renderer → main, request/response.

export const appStatusRequestSchema = z.object({});

export const appStatusResponseSchema = z.object({
  version: z.string(),
  platform: z.string(),
  startedAt: z.number().int(),
});

export type AppStatusResponse = z.infer<typeof appStatusResponseSchema>;

const conversationListResponse = z.object({ conversations: z.array(conversationViewSchema) });

export const commands = {
  'app.status': {
    request: appStatusRequestSchema,
    response: appStatusResponseSchema,
  },
  'app.capabilities': {
    request: z.object({}),
    response: capabilitiesSchema,
  },
  /** Open the macOS privacy pane the user needs (onboarding, plan step 7). */
  'app.openPermissionSettings': {
    request: z.object({ pane: z.enum(['full-disk-access', 'automation']) }),
    response: z.object({}),
  },
  'conversations.list': {
    request: z.object({
      view: listViewSchema,
      space: spaceScopeSchema,
      limit: z.number().int().positive().max(500),
    }),
    response: conversationListResponse,
  },
  'conversations.search': {
    request: z.object({
      query: z.string().min(1),
      space: spaceScopeSchema,
      limit: z.number().int().positive().max(200),
    }),
    response: conversationListResponse,
  },
  'thread.page': {
    request: z.object({
      chatGuid: z.string(),
      limit: z.number().int().positive().max(200),
      beforeRowId: z.number().int().optional(),
    }),
    response: z.object({
      items: z.array(messageItemSchema),
      nextBeforeRowId: z.number().int().nullable(),
    }),
  },
  /** Hand the conversation to Messages.app (best effort; step 9). */
  'conversation.openInMessages': {
    request: z.object({ chatGuid: z.string() }),
    response: z.object({}),
  },
  'workflow.archive': {
    request: z.object({ chatGuid: z.string() }),
    response: z.object({ state: workflowStateSchema }),
  },
  'workflow.snooze': {
    request: z.object({ chatGuid: z.string(), wakeAt: z.number().int() }),
    response: z.object({ state: workflowStateSchema }),
  },
  'workflow.restore': {
    request: z.object({ chatGuid: z.string() }),
    response: z.object({ state: workflowStateSchema }),
  },
  'workflow.markSeen': {
    request: z.object({ chatGuid: z.string() }),
    response: z.object({}),
  },
  'spaces.list': {
    request: z.object({}),
    response: z.object({ spaces: z.array(spaceSchema) }),
  },
  'spaces.create': {
    request: z.object({ name: z.string().min(1).max(80) }),
    response: spaceOutcome(spaceSchema),
  },
  'spaces.rename': {
    request: z.object({ id: z.number().int(), name: z.string().min(1).max(80) }),
    response: spaceOutcome(spaceSchema),
  },
  'spaces.reorder': {
    request: z.object({ id: z.number().int(), position: z.number().int().nonnegative() }),
    response: spaceOutcome(z.array(spaceSchema)),
  },
  'spaces.delete': {
    request: z.object({ id: z.number().int() }),
    response: spaceOutcome(z.null()),
  },
  'spaces.assign': {
    request: z.object({ chatGuid: z.string(), spaceId: z.number().int().nullable() }),
    response: spaceOutcome(z.null()),
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
  /** Source rows changed in these conversations; re-query to see what. */
  'conversations.changed': z.object({ chatGuids: z.array(z.string()) }),
  /** rx workflow state changed outside a renderer-initiated command. */
  'workflow.changed': z.object({ chatGuid: z.string(), state: workflowStateSchema }),
  'capabilities.changed': capabilitiesSchema,
} as const;

export type EventName = keyof typeof events;

export type EventPayload<E extends EventName> = z.infer<(typeof events)[E]>;

// ---------------------------------------------------------------------------
// The API surface preload exposes to the renderer as `window.rx`.

export interface RxApi {
  invoke<C extends CommandName>(
    command: C,
    request: CommandRequest<C>,
  ): Promise<CommandResponse<C>>;
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
}
