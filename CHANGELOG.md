# Changelog

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
