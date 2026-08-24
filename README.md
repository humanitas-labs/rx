# RX

RX is a local-first Apple Messages client for macOS, built around inbox zero.

Ordinary message lists mix conversations that need a reply with conversations
that are already handled. RX adds a simple workflow on top of the Messages data
already stored on your Mac: reply, archive, or snooze a conversation and trust
that it will return when it matters again.

RX is in pre-alpha development. It is not ready for general use.

## What RX does

The first release is designed to provide:

- Inbox, Snoozed, and Archive views for Apple Messages conversations;
- local archive and snooze state that survives restart;
- automatic resurfacing when a new message arrives;
- reading of text, attachments, reactions, replies, edits, and group events;
- text and file sending through Messages.app with delivery verification;
- search across conversation names and decoded message text; and
- keyboard-first and pointer-based operation.

Archive and snooze are RX features. They do not delete or hide the conversation
inside Messages.app.

## How it works

RX treats Apple Messages as the communication system and adds its own workflow
state alongside it.

```text
Apple Messages database (read-only)
                ↓
        Electron main process
        ├── conversation reader
        ├── source-change observer
        ├── delivery through Messages.app
        └── RX workflow database
                ↓
        isolated preload API
                ↓
           React renderer
```

RX reads `~/Library/Messages/chat.db` without modifying it. Outbound messages
are sent through Messages.app rather than written into the database. A send is
reported as successful only after the resulting outgoing record appears in the
intended conversation.

RX stores only its own workflow metadata, such as whether a conversation is
archived or snoozed and when it should return. Message bodies and attachments
remain in Apple’s storage.

See the [v0 scope](docs/v0-scope.md) and
[architecture decision](docs/decisions/002-electron-architecture.md) for the
current product and technical boundaries.

## Privacy and permissions

RX is local-only. It does not operate a message server or upload conversation
history.

The application will require:

- **Full Disk Access** to read the local Messages database; and
- **Automation permission** to ask Messages.app to send messages.

The renderer does not receive filesystem, database, shell, or raw Electron IPC
access. Apple-owned databases are opened read-only.

RX maintains its own seen state in v0. Opening a conversation in RX may not
clear the unread badge or send a read receipt in Messages.app.

## Current status

Platform feasibility work is underway. The current spikes have established
that:

- modern message bodies can be decoded from Apple’s attributed-body format;
- source changes can be detected incrementally without repeatedly scanning the
  entire message database;
- text messages can be sent through Messages.app and verified against the
  resulting source record; and
- attachment sending requires further investigation across AppleScript target
  and file-coercion variants.

The evidence and open risks are recorded in the
[platform spike findings](docs/findings/platform-spike.md).

## Planned v0 limitations

- macOS only;
- Apple Messages only;
- no new group creation or membership editing;
- no reaction sending, sent-message editing, or unsend;
- no deletion of Apple messages or conversations;
- no synchronization of RX archive or snooze state between Macs; and
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
[v0 implementation plan](.plan/v0.md).
The current interface source is listed in the
[design index](docs/design/index.md).

## License

Licensing will be finalized before the first distributable build. The current
message-decoding dependency is GPL-3.0, so any shipped application containing it
must use a compatible license.
