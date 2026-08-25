# Changelog

## 0.11.0 — 2026.08.25

Triage keys, contact photos, and a first vibrancy pass.

- Navigation `s` / `a` / `m` open snooze, archive, and Move to Space. The
  same commands are labeled in the palette. Hover archive/snooze glyphs are
  gone; context menu still covers them.
- Overlays (snooze, move, palette, new conversation, context menu) share one
  card. Composer nudged right; scrollbar thumb matches the composer fill.
- Window uses under-window vibrancy with a 0.86 dark wash so the desktop
  reads as grain (iss-0021). Bubbles and the composer stay opaque.
- Contact profile pictures render in conversation rows and the reader header,
  with initials as the fallback. The helper re-encodes each address-book
  thumbnail at avatar size, and main serves the bytes over `rx-avatar://`.
- The contacts helper is ad-hoc signed after compile (`codesign --sign -`).
  `--remove-signature` was killing it on Apple silicon outside packaged builds.

## 0.10.0 — 2026.08.25

Contact names, mark-unread, and composer polish.

- Conversation titles and group sender labels resolve through a signed
  `rx-contacts` helper (ADR-005). The snapshot stays in memory; denial falls
  back to Messages display names and raw handles. electron-builder signs the
  helper with the app identity and the address-book entitlement.
- `u`, the palette, and the row menu mark a conversation unread in rx
  (`workflow.markUnseen`). Apple's `is_read` is untouched. An open chat stays
  unread until selection leaves it.
- Composer caret is a 2px overlay (iss-0007). Bubble inset tightened to 8×14.
- Pre-implementation `spikes/apple-platform` and the platform-findings note
  are retired; production modules own those paths.

## 0.9.0 — 2026.08.24

Live source events and the background lifecycle (plan step 11).

- The inbox is live: a runtime starts source observation (WAL watch plus a
  poll fallback) once permission and schema checks pass, converts new
  source rows into per-conversation events, and pushes
  `conversations.changed` to the renderer — lists refresh and the open
  thread appends new messages in place.
- Resurface transitions are persisted *before* the renderer is notified,
  so re-queries always see the settled workflow state: a new inbound
  message returns an archived or snoozed conversation to Inbox
  (spec §3.3); outbound rows written by Messages.app are visible but never
  restore anything.
- Snooze wake pass runs on launch (catching snoozes that came due while rx
  was closed), on system resume via powerMonitor (a lid-open wake surfaces
  due snoozes immediately), and on a bounded 30 s timer.
- Monitoring failures are visible and retryable: a locked or unreadable
  database flips a sidebar banner ("Live updates interrupted — retrying…")
  instead of silently presenting a stale inbox; the observer keeps
  retrying, recovery clears the banner, and rows that arrived during the
  outage are caught up on the first healthy pass.
- Reading the bottom of an open conversation keeps it read (seen watermark
  advances only while the window has focus); new messages auto-scroll only
  when already at the bottom — arriving mail never yanks the view out of
  scrolled-back history.

## 0.8.0 — 2026.08.24

Compose, new conversation, and delivery verification (plan step 10).

- Sending is live: the composer sends with ⌘↩ (or the palette's Send
  message) to the open conversation, one-to-one or group. Text travels to
  Messages automation as osascript arguments — never interpolated into
  script source.
- Delivery is verified, not assumed: rx records the pre-send source cursor,
  runs the automation, and waits for the matching outgoing record in the
  intended conversation (decoded body match — outbound bodies land in
  attributedBody). Automation exit success without a source record reports
  as failure, a row landing in any other conversation never matches, and an
  identical older message can't satisfy verification.
- Pending / verified / failed states in the composer; a failed send keeps
  the draft, names the cause (Automation denied, Messages unavailable,
  unconfirmed, automation error), and the draft clears only on
  verification. A verified send restores an archived or snoozed
  conversation to Inbox; a failed one changes nothing.
- New conversation: the compose button (and palette command) opens an
  overlay taking an explicit phone number or email plus the first message;
  on verified delivery the created chat is selected in Inbox.
  Contacts-backed search waits on the native Contacts bridge (spike 6).
- File sending stays descoped (iss-0001); the verification model is exactly
  what catches that platform regression's silent drop.

## 0.7.0 — 2026.08.24

The conversation reader (plan step 9).

- Thread assembly: time separators (first item, then after an hour of
  silence), same-sender runs within a minute, tapbacks netted onto their
  target bubbles (standard glyphs plus custom-emoji reactions; removals
  cancel adds), reply snippets from `thread_originator_guid`, formatted
  group announcements, and typed fallbacks — all pure and unit-tested.
- Attachments ride on thread items as metadata (name, type, size, local
  presence) and render inline: images load over a new read-only
  `rx-attachment://` protocol that resolves the GUID back to the local file
  under `~/Library/Messages` in main — nothing is copied into rx storage,
  and the renderer never sees or supplies filesystem paths. Undecodable
  images (HEIC) and non-images fall back to a file chip; attachment-only
  messages render without a phantom bubble (U+FFFC placeholders stripped).
- Older history pages in from the top without scroll jumps (scroll-height
  anchoring), latest page first, retry on scroll after a failed page.
- Open in Messages from the row context menu, reader header menu, and the
  palette: direct chats deep-link to the handle, groups bring Messages.app
  forward.
- The reply and custom-emoji columns are probed per database and substituted
  with NULL on older schemas, so paging works either way.
- Reader thread gutters tightened from the frame's 78/84 px to 40/44 px by
  request.

## 0.6.1 — 2026.08.24

Design-fidelity pass against the source frames (48-2191, 48-2301), built
from the frames' own values and exported vectors rather than approximations.

- Palette corrected throughout: window `#141414`, raised surfaces `#171717`,
  hairlines `#252525`, green edge bars `#b2faae` for active (4×32) and hover
  (4×12) rows, unread dot `#00ccff`, bubbles `#1f1f1f` / `#009df8`,
  secondary text `#979d9c` / `#9a9a9a`, placeholders `#4d4d4d`.
- Sidebar to frame: no right border, glyph view tabs (the design's SF Symbol
  SVGs via CSS masks — white when active, `#3c3b39` idle), filter glyph on
  the right, circled compose button top-right, icon-only hexagon Space
  button bottom-left, rows with indented hairlines, 11.4/13 px type ramp,
  and no filled selection background — the edge bar carries selection.
- Reader to frame: centered avatar + name + chevron header (the chevron is
  the actions menu trigger), 12.3 px bubbles at the design radii and
  shadows, thread column inset to the frame's gutters, 32 px composer pill
  aligned with the Space button row.
- Space switcher to frame: rows float on a blurred scrim
  (`rgba(0,0,0,0.35)` + 15 px backdrop blur), 32 px icon circles with 14 px
  medium labels at 47 px pitch, active row as `#171717` squircle plus the
  green edge bar, New Space as a dashed circle.
- Traffic lights repositioned to 16,16; the design's SVG assets are
  committed under `src/renderer/src/assets/`.

## 0.6.0 — 2026.08.24

Inbox, Snoozed, Archive, and search to design (plan step 8).

- Conversation rows carry the designed anatomy: one-line preview of the
  latest message (attributed bodies decoded through a shared cache, outbound
  prefixed `You:`, typed fallbacks for reactions, group events, app messages,
  and attachments), fixed-height rows, the 4×12 hover bar, and future wake
  times rendered as day + clock.
- The sidebar list is virtualized (pure window arithmetic, spacer heights,
  selection kept scrolled into view) and requests up to 500 conversations.
- Triage from every path: hover glyphs and a right-click context menu on
  rows, an actions menu in the reader header, and the palette — archive,
  snooze, restore, and move-to-Space, all with no optimistic disappearance.
- Snooze picker overlay: quick presets (1 hour, this evening, tomorrow
  morning, next Monday — all strictly future) plus a custom local date-time
  with validation; `Snooze…` and `Move to Space…` palette commands complete
  the keyboard paths.
- Space management in the switcher: inline rename with duplicate-name
  errors, up/down reorder, and delete behind an inline confirm (members
  return to Unassigned; workflow state untouched).
- Search now runs against the source — group names, participant handles,
  plain text, and a bounded scan (2,000 most recent) of decoded
  attributed-body-only messages — debounced with stale-response
  cancellation, scoped to the active Space and view.
- Selection preservation: when triage removes the selected row, selection
  lands on its neighbor instead of jumping to the top.

## 0.5.0 — 2026.08.24

Onboarding and the application shell (plan step 7).

- Modal keyboard core per docs/spec/keyboard.md: pure `resolveKey` with the
  §5 event-priority order (IME, overlay, global modified shortcuts, text
  modes, Navigation), the 750 ms `g s` chord that never swallows a failed
  chord's key, and palette entries that keep unavailable commands visible
  with a reason. 20 unit tests.
- Shell: frameless dark window (hiddenInset traffic lights), sidebar with
  Inbox/Snoozed/Archive tabs (`1`/`2`/`3`), `j`/`k` selection with per-
  (Space, view) memory and nearest-row fallback, `/` filter with two-stage
  Escape, Space switcher overlay (`g s`, frame 48-2301: All, user Spaces
  with ⌘ numbers, Unassigned, inline New Space), and a `Cmd-K` command
  palette wired to the single command registry (archive, snooze presets,
  restore included; no optimistic disappearance).
- Reader: latest 50 items with typed fallbacks, seen-watermark advance on
  open, draft-preserving composer entering Insert mode (`i`/`Escape`);
  sending stays visibly disabled until step 10.
- Onboarding: capability-gated routing with per-permission status and
  actions (Full Disk Access deep link, schema-drift fatal state,
  Messages.app presence, Automation explained); polls every 2 s and the
  main-process reader now opens lazily, so granting access flips to the
  shell without a relaunch.

## 0.4.0 — 2026.08.24

Application read models and the full command surface (plan step 6).

- `packages/core/src/application/`: pure read models joining source
  summaries with workflow state and Space assignment — default Inbox,
  Unassigned, effective-state reconciliation (a due snooze or newer inbound
  reads as Inbox), rx unread from the seen watermark, and per-view ordering
  (Snoozed by wake time).
- `@rx/contract` grows the renderer-facing surface: conversation views,
  spaces, thread items, capabilities, and 13 commands (list, search, thread
  paging, archive/snooze/restore/mark-seen, five Space operations) plus
  conversation/workflow/capability change events. Space failures are typed
  outcomes, not thrown errors.
- `apps/desktop/src/main/app/commands.ts`: Electron-free command factory
  wiring reader, decoder, and store; main opens the workflow database at
  `userData/workflow.db` (`app.setName('rx')` so dev and packaged builds
  share it) and loads the decoder wasm as a bundled asset.
- Search matches group names, participant handles, and plain message text
  with LIKE-escaping; decoded-body indexing is deferred to step 8.
- 16 integration tests drive every command through the production guard
  (contract-validated both directions) against the synthetic fixture.
- Core packages drop internal `@/` aliases in `src/` (they cannot resolve
  when another package consumes the source); tests keep them.

## 0.3.0 — 2026.08.24

rx workflow store and state machine (plan step 5).

- `packages/core/src/workflow/`: persistent store over a separate rx SQLite
  database (`node:sqlite`, WAL, foreign keys, `user_version` migrations) with
  the plan's `conversation_state`/`spaces`/`conversation_space` schema.
  Watermarks store the message GUID (durable identity) plus the local ROWID
  cursor (ordering); every transition is one transaction with a typed outcome.
- Transitions: archive, snooze, restore, mark-seen (forward-only), inbound and
  verified-outbound resurfacing through the pure `reconcile` rules, `wakeDue`,
  and the five Space operations plus assignment. Space moves and deletes never
  touch workflow state; deleting a Space returns members to Unassigned.
- 22 table-driven tests: restart recovery, duplicate source events, watermark
  boundaries, clock boundaries at the snooze deadline, missing source
  conversations, and idempotent replay.

## 0.2.0 — 2026.08.24

Apple Messages source module (plan step 4, read side).

- `apps/desktop/src/main/apple-messages/`: read-only database access via
  `node:sqlite` (ADR-004), conversation summaries with participants and
  unread metadata, thread paging with typed classification (text,
  attributed-body via the WASM decoder, tapback, group event, unsupported
  balloon/undecodable fallbacks), attachment metadata, WAL-watch + poll
  source observer with a durable MAX(ROWID) cursor, and capability
  reporting (permissions, schema drift, Messages.app presence).
- Synthetic chat.db fixture (schema subset, invented conversations) plus a
  202-byte NSArchiver typedstream fixture; 16 fixture tests cover every
  supported content type.
- Opt-in live diagnostic (`RX_LIVE=1`) lists 100 real conversation
  summaries emitting statistics only: 352 ms on the development machine.

## 0.1.0 — 2026.08.24

Initial workspace scaffold (plan step 3).

- pnpm workspace: `apps/desktop` (Electron + React + TypeScript + Vite via
  electron-vite), `packages/contract`, `packages/core`,
  `packages/apple-body-decoder`, `packages/apple-contacts`.
- Typed IPC contract: one command (`app.status`) and one event
  (`app.heartbeat`) validated with zod in both directions across
  main/preload/renderer; renderer sandboxed with context isolation.
- Decoder boundary promoted from spike 5b: Rust crate compiled to
  `wasm32-unknown-unknown`, zero-import instantiation, structured
  `DecodedBody` output, malformed-input containment tests.
- Core domain: workflow states and pure archive/snooze/resurface transition
  rules from spec/v0.md §3, unit-tested.
- Quality gates: strict TypeScript, eslint, prettier, vitest, clippy with
  warnings as errors.
- Packaging: electron-builder producing a development-signed `rx.app`
  (`sh.rx.desktop`) with hardened runtime and JIT entitlements for WASM.
