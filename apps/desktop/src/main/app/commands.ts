// Application command handlers (plan step 6): the only place source reads,
// the workflow store, and the core read models meet. Electron-free so the
// full command surface is testable against fixtures; ipc/index.ts binds the
// result to ipcMain.

import type { BodyDecoder } from '@rx/apple-body-decoder';
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
import type { MessagesReader } from '@/apple-messages/reader';
import { searchChatGuids } from '@/apple-messages/search';
import type { CommandHandler } from '@/ipc/registry';

export type CommandHandlers = { [C in CommandName]?: CommandHandler<C> };

export interface AppServices {
  /** Null until source capabilities pass (permission, schema). */
  reader: MessagesReader | null;
  decoder: BodyDecoder;
  store: WorkflowStore;
  messagesDbPath: string;
  now?: () => number;
}

/** How many recent source conversations the read models compose over. */
const SOURCE_WINDOW = 500;

export function createCommands(services: AppServices): CommandHandlers {
  const now = services.now ?? Date.now;

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

  return {
    'app.capabilities': () => checkCapabilities(services.messagesDbPath),

    'conversations.list': ({ view, space, limit }) => {
      const summaries = listConversationSummaries(requireReader(), { limit: SOURCE_WINDOW });
      const selected = selectConversations(composeViews(summaries), view, space);
      return { conversations: selected.slice(0, limit) };
    },

    'conversations.search': ({ query, space, limit }) => {
      const reader = requireReader();
      const chatGuids = searchChatGuids(reader, query, limit);
      if (chatGuids.length === 0) {
        return { conversations: [] };
      }
      const summaries = listConversationSummaries(reader, { limit, chatGuids });
      const scoped = composeViews(summaries).filter((row) => inScope(row.spaceId, space));
      return { conversations: scoped.sort((a, b) => b.lastActivityAtMs - a.lastActivityAtMs) };
    },

    'thread.page': ({ chatGuid, limit, beforeRowId }) =>
      pageMessages(requireReader(), services.decoder, chatGuid, { limit, beforeRowId }),

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
