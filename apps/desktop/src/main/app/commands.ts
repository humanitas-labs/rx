// Application command handlers (plan step 6): the only place source reads,
// the workflow store, and the core read models meet. Electron-free so the
// full command surface is testable against fixtures; ipc/index.ts binds the
// result to ipcMain.

import type { BodyDecoder } from '@rx/apple-body-decoder';
import { createFallbackBridge, type ContactsBridge } from '@rx/apple-contacts';
import type { CommandName, SpaceScope } from '@rx/contract';
import {
  composeConversationViews,
  selectConversations,
  type ConversationView as CoreConversationView,
  type SourceConversationSummary,
} from '@rx/core';
import type { WorkflowStore } from '@rx/core';

import { checkCapabilities } from '@/apple-messages/capabilities';
import {
  latestRefs,
  listConversationSummaries,
  type ConversationSummary,
} from '@/apple-messages/conversations';
import { pageMessages } from '@/apple-messages/messages';
import type { DecodedTextCache } from '@/apple-messages/previews';
import type { MessagesReader } from '@/apple-messages/reader';
import { searchChatGuids } from '@/apple-messages/search';
import { DEFAULT_DELIVERY_TIMING, deliver, type DeliveryTiming } from '@/delivery/delivery';
import { runAutomation, type SendAutomation } from '@/delivery/send';
import type { CommandHandler } from '@/ipc/registry';

export type CommandHandlers = { [C in CommandName]?: CommandHandler<C> };

export interface AppServices {
  /** Null until source capabilities pass (permission, schema). */
  reader: MessagesReader | null;
  decoder: BodyDecoder;
  store: WorkflowStore;
  messagesDbPath: string;
  now?: () => number;
  /** Handle→name resolution (ADR-005); defaults to the fallback bridge. */
  contacts?: ContactsBridge;
  /** Overridable so tests can fake Messages automation. */
  automation?: SendAutomation;
  deliveryTiming?: DeliveryTiming;
}

/** How many recent source conversations the read models compose over. */
const SOURCE_WINDOW = 500;

export function createCommands(services: AppServices): CommandHandlers {
  const now = services.now ?? Date.now;
  // Shared decode cache: previews and body search never re-decode a blob.
  const decodedTextCache: DecodedTextCache = new Map();
  const preview = () => ({ decoder: services.decoder, cache: decodedTextCache });

  function requireReader(): MessagesReader {
    if (services.reader === null) {
      throw new Error('source-unavailable');
    }
    return services.reader;
  }

  function composeViews(summaries: ConversationSummary[]): CoreConversationView[] {
    return composeConversationViews(
      summaries.map(toSourceSummary),
      services.store.listConversations(),
      services.store.listAssignments(),
      now(),
    );
  }

  const contacts = services.contacts ?? createFallbackBridge();

  async function nameMap(handles: Iterable<string>): Promise<Map<string, string>> {
    const unique = [...new Set(handles)];
    if (unique.length === 0) {
      return new Map();
    }
    const resolved = await contacts.resolve(unique);
    const names = new Map<string, string>();
    for (const entry of resolved) {
      if (entry.displayName !== null) {
        names.set(entry.handle, entry.displayName);
      }
    }
    return names;
  }

  // Unnamed conversations title as their participants; resolved contact
  // names replace raw handles wherever the address book knows them. Group
  // chats with an explicit display name keep it, like Messages.app.
  async function withContactNames(views: CoreConversationView[]): Promise<CoreConversationView[]> {
    const names = await nameMap(
      views.filter((view) => view.displayName === null).flatMap((view) => view.participantHandles),
    );
    if (names.size === 0) {
      return views;
    }
    return views.map((view) =>
      view.displayName !== null
        ? view
        : {
            ...view,
            displayName:
              view.participantHandles.map((handle) => names.get(handle) ?? handle).join(', ') ||
              null,
          },
    );
  }

  return {
    'app.capabilities': () => checkCapabilities(services.messagesDbPath),

    'conversations.list': async ({ view, space, limit }) => {
      const summaries = listConversationSummaries(requireReader(), {
        limit: SOURCE_WINDOW,
        preview: preview(),
      });
      const selected = selectConversations(
        await withContactNames(composeViews(summaries)),
        view,
        space,
      );
      return { conversations: selected.slice(0, limit) };
    },

    'conversations.search': async ({ query, space, limit }) => {
      const reader = requireReader();
      const chatGuids = searchChatGuids(reader, query, limit, preview());
      if (chatGuids.length === 0) {
        return { conversations: [] };
      }
      const summaries = listConversationSummaries(reader, { limit, chatGuids, preview: preview() });
      const scoped = (await withContactNames(composeViews(summaries))).filter((row) =>
        inScope(row.spaceId, space),
      );
      return { conversations: scoped.sort((a, b) => b.lastActivityAtMs - a.lastActivityAtMs) };
    },

    'thread.page': async ({ chatGuid, limit, beforeRowId }) => {
      const page = pageMessages(requireReader(), services.decoder, chatGuid, {
        limit,
        beforeRowId,
      });
      const names = await nameMap(
        page.items.flatMap((item) =>
          item.base.senderHandle === null ? [] : [item.base.senderHandle],
        ),
      );
      if (names.size === 0) {
        return page;
      }
      return {
        ...page,
        items: page.items.map((item) => {
          const senderName =
            item.base.senderHandle === null ? null : (names.get(item.base.senderHandle) ?? null);
          return senderName === null ? item : { ...item, base: { ...item.base, senderName } };
        }),
      };
    },

    'compose.send': async ({ target, text }) => {
      const outcome = await deliver(
        {
          reader: requireReader(),
          decoder: services.decoder,
          automation: services.automation ?? runAutomation,
        },
        target,
        text,
        services.deliveryTiming ?? DEFAULT_DELIVERY_TIMING,
      );
      if (outcome.state === 'failed') {
        return { outcome };
      }
      // Only a verified outbound restores archived/snoozed to Inbox
      // (spec §4.4); a failed send leaves workflow state untouched.
      const { chatGuid, messageGuid, rowId } = outcome.verified;
      services.store.verifyOutbound(chatGuid, { guid: messageGuid, rowId }, now());
      return { outcome: { state: 'verified' as const, chatGuid, messageGuid } };
    },

    'workflow.archive': ({ chatGuid }) => {
      const refs = latestRefs(requireReader(), chatGuid);
      services.store.archive(chatGuid, refs.latestInbound, now());
      return { state: { kind: 'archived' as const } };
    },

    'workflow.snooze': ({ chatGuid, wakeAt }) => {
      const refs = latestRefs(requireReader(), chatGuid);
      services.store.snooze(chatGuid, refs.latestInbound, wakeAt, now());
      return { state: { kind: 'snoozed' as const, wakeAt } };
    },

    'workflow.restore': ({ chatGuid }) => {
      services.store.restore(chatGuid, now());
      return { state: { kind: 'inbox' as const } };
    },

    'workflow.markSeen': ({ chatGuid }) => {
      const refs = latestRefs(requireReader(), chatGuid);
      if (refs.latest !== null) {
        services.store.markSeen(chatGuid, refs.latest, now());
      }
      return {};
    },

    'workflow.markUnseen': ({ chatGuid }) => {
      services.store.markUnseen(chatGuid, now());
      return {};
    },

    'spaces.list': () => ({ spaces: services.store.listSpaces() }),
    'spaces.create': ({ name }) => services.store.createSpace(name, now()),
    'spaces.rename': ({ id, name }) => services.store.renameSpace(id, name, now()),
    'spaces.reorder': ({ id, position }) => services.store.reorderSpace(id, position, now()),
    'spaces.delete': ({ id }) => services.store.deleteSpace(id),
    'spaces.assign': ({ chatGuid, spaceId }) => services.store.assignSpace(chatGuid, spaceId),
  };
}

function toSourceSummary(summary: ConversationSummary): SourceConversationSummary {
  return {
    chatGuid: summary.chatGuid,
    displayName: summary.displayName,
    participantHandles: summary.participantHandles,
    isGroup: summary.isGroup,
    lastActivityAtMs: summary.lastActivityAtMs,
    lastInbound:
      summary.lastInboundGuid === null || summary.lastInboundRowId === null
        ? null
        : { guid: summary.lastInboundGuid, rowId: summary.lastInboundRowId },
    sourceUnreadCount: summary.unreadCount,
    previewText: summary.previewText,
  };
}

function inScope(spaceId: number | null, space: SpaceScope): boolean {
  if (space === 'all') {
    return true;
  }
  if (space === 'unassigned') {
    return spaceId === null;
  }
  return spaceId === space;
}
