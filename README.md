# rx

rx is a local-first Apple Messages client for macOS, built around inbox zero.

Ordinary message lists mix conversations that need a reply with conversations
that are already handled. rx adds a simple workflow on top of the Messages data
already stored on your Mac: reply, archive, or snooze a conversation and trust
that it will return when it matters again.

rx is in pre-alpha development. It is not ready for general use.

## What rx does

The first release is designed to provide:

- Inbox, Snoozed, and Archive views for Apple Messages conversations;
- Spaces — user-defined contexts such as Personal and Business, each with its
  own Inbox, Snoozed, and Archive, plus an aggregate All view;
- local archive and snooze state that survives restart;
- automatic resurfacing when a new message arrives;
- reading of text, attachments, reactions, replies, edits, and group events;
- text sending through Messages.app with delivery verification;
- search across conversation names and decoded message text; and
- keyboard-first and pointer-based operation.

Archive and snooze are rx features. They do not delete or hide the conversation
inside Messages.app.

Spaces partition conversations by context:

```text
All
├── Personal
├── Business
└── Unassigned
```

Each conversation belongs to exactly one Space; unassigned conversations live
in Unassigned. Triage state stays with the conversation, so moving it between
Spaces never loses archive, snooze, or unread state.

## How it works

rx treats Apple Messages as the communication system and adds its own workflow
state alongside it.

```text
Apple Messages database (read-only)
                ↓
        Electron main process
        ├── conversation reader
        ├── source-change observer
        ├── delivery through Messages.app
        └── rx workflow database
                ↓
        isolated preload API
                ↓
           React renderer
```

rx reads `~/Library/Messages/chat.db` without modifying it. Outbound messages
are sent through Messages.app rather than written into the database. A send is
reported as successful only after the resulting outgoing record appears in the
intended conversation.

rx stores only its own workflow metadata, such as whether a conversation is
archived or snoozed and when it should return. Message bodies and attachments
remain in Apple’s storage.

See the [v0 scope](docs/v0-scope.md) and
[architecture decision](docs/decisions/002-electron-architecture.md) for the
current product and technical boundaries.

## Privacy and permissions

rx is local-only. It does not operate a message server or upload conversation
history.

The application will require:

- **Full Disk Access** to read the local Messages database; and
- **Automation permission** to ask Messages.app to send messages.

The renderer does not receive filesystem, database, shell, or raw Electron IPC
access. Apple-owned databases are opened read-only.

rx maintains its own seen state in v0. Opening a conversation in rx may not
clear the unread badge or send a read receipt in Messages.app.

## Current status

Platform feasibility work is underway. The current spikes have established
that:

- modern message bodies can be decoded from Apple’s attributed-body format;
- source changes can be detected incrementally without repeatedly scanning the
  entire message database;
- text messages can be sent through Messages.app and verified against the
  resulting source record; and
- attachment sending through the scripting interface silently drops the file
  on current macOS; it is descoped from v0 (issue #2).

The evidence and open risks are recorded in the
[platform spike findings](docs/findings/platform-spike.md).

## Planned v0 limitations

- macOS only;
- Apple Messages only;
- no new group creation or membership editing;
- no file-attachment sending (silently broken in Apple's scripting interface
  on current macOS — see issue #2); attachments are still received and shown;
- no reaction sending, sent-message editing, or unsend;
- no deletion of Apple messages or conversations;
- no synchronization of rx archive or snooze state between Macs; and
- direct distribution rather than the Mac App Store.

## Development

The application scaffold has not been created yet. The approved direction is an
Electron application with a TypeScript main process, isolated preload API, and
React renderer. Small native modules will handle Apple-specific decoding and
Contacts access.

Reproducible platform experiments live under
[`spikes/apple-platform/`](spikes/apple-platform/). They must not print or
commit message content, contact handles, or chat identifiers.

The full implementation sequence is documented in the
[v0 implementation plan](.plan/v0.md). Known issues are tracked in the
[issue index](.issues/index.md).
The current interface source is listed in the
[design index](docs/design/index.md).

## License

rx is licensed under the [GNU General Public License v3.0](LICENSE). The
message-decoding dependency chain is GPL-3.0-or-later, and rx adopts the same
license for the whole application.
