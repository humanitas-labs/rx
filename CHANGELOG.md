# Changelog

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
