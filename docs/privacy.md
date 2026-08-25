# rx local-data contract

rx is local-only. It has no server, no account, no telemetry, and no network
transmission of message content. Everything below happens on your Mac.

## What rx reads

| Data | Location | Access |
|---|---|---|
| Messages database | `~/Library/Messages/chat.db` (+ WAL) | Read-only SQLite |
| Attachments | `~/Library/Messages/Attachments/…` | Read-only, served in place |

- The Messages database is opened with SQLite's read-only flag. rx never
  executes a write statement against an Apple-owned database, and the
  connection cannot.
- Attachments are rendered from their original location. rx does not copy
  message bodies or attachment files into its own storage.
- Change detection watches the database's WAL file for activity and reads
  only rows newer than a saved cursor. The events rx derives from this carry
  conversation identity only, never message content.

## What rx writes, and where

rx stores exactly one database of its own:

```
~/Library/Application Support/rx/workflow.db
```

It contains rx workflow metadata keyed by Apple's conversation identifiers:

- archive / snooze / inbox state and snooze wake times;
- the per-conversation "seen" watermark (a message identifier, used for rx's
  own unread indicator);
- Spaces (names, ordering) and each conversation's Space assignment.

It contains no message text, no attachment data, and no contact names.

## Sending

Outbound messages are sent by asking Messages.app to send them (Apple's
scripting interface), never by writing into Apple's database. The message text
is passed to the automation as an argument. rx reports a send as delivered
only after the resulting outgoing record appears in the intended conversation
in Apple's own data; an automation that "succeeds" without producing a record
is reported as a failure.

## Permissions

- **Full Disk Access** — the only way macOS allows reading
  `~/Library/Messages`. Revoking it returns rx to its onboarding screen; rx
  keeps working again as soon as it is re-granted, without a relaunch.
- **Automation (Messages)** — requested by macOS on the first send. Denying
  it disables sending only; reading is unaffected.
- **Contacts** — requested to resolve participant phone numbers and email
  addresses to display names and profile pictures through Apple’s Contacts
  framework. rx loads a read-only snapshot through its signed helper, keeps
  the lookup index and the avatar images in memory, and never stores contact
  cards, names, or photos on disk. Denial falls back to Messages display
  names, raw handles, and initials.

## What rx does not do

- No reading or writing of iCloud data; rx sees only what Messages.app has
  already synced to this Mac.
- No read receipts: opening a conversation in rx does not mark it read in
  Messages.app or signal anything to the sender.
- No typing indicators, in either direction — these are transient Apple
  service signals that never reach supported surfaces.
- No modification or deletion of Apple messages or conversations. Archive and
  snooze exist only in rx's own database.

## Uninstalling

Remove rx.app and delete `~/Library/Application Support/rx/`. That directory
is the entirety of rx's stored state; deleting it removes every trace of rx's
workflow data. Your Messages history is untouched either way. Permission
grants can be cleaned up under System Settings → Privacy & Security (Full
Disk Access, Automation).
