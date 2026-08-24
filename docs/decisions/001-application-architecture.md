# ADR-001 :: RX v0 Application Architecture

Last updated: `2026.08.24`

**Status:** Rejected `2026.08.24`

**Superseded by:** [ADR-002](002-electron-architecture.md)

The Tauri proposal was rejected before implementation. RX will use Electron;
the reasoning below remains the record of the alternative considered.

> Build RX as a Tauri desktop application with a Rust application core and a
> React/TypeScript renderer. RX owns its domain model and local workflow store;
> Apple Messages remains the source and transport system.

---

## 1. Decision

- Use Tauri 2 for the macOS application shell.
- Implement Apple database access, decoding, source observation, delivery, and
  RX workflow state in Rust.
- Implement the approved designs in React and TypeScript.
- Open Apple-owned SQLite databases read-only.
- Store RX-owned state in a separate SQLite database under the application data
  directory.
- Send through the supported Messages.app scripting command and verify the
  resulting source record.
- Define RX domain types independently of the existing `imsg` CLI.
- Reuse low-level code or dependencies from `imsg` only after they conform to
  RX’s domain and privacy boundaries.
- Do not introduce a generic provider abstraction in v0.

## 2. Rationale

The application is macOS-only but needs a custom, design-led desktop interface
and a reliable parser for Apple’s Messages database. Rust already has a proven
decoder for the attributed-body format that contains most modern message text.
Tauri keeps that code in-process with the local state machine while allowing the
finished interface to be implemented directly from the product designs.

A native SwiftUI application would provide the strongest platform-native shell.
It would also require either a Rust bridge for the message decoder or a new
decoder implementation before product work could begin. That cost does not buy
a user-visible v0 behavior. Revisit native Swift only if the designs require an
AppKit capability Tauri cannot deliver or the Rust decoder can be replaced
without losing correctness.

Electron would make the renderer familiar but would still require a Rust
sidecar or a second attributed-body decoder. It adds a second process and a
larger runtime without simplifying the hard source boundary.

Using `imsg` as a subprocess or application service was rejected. Its CLI query
model, confirmation behavior, and process lifecycle were designed for terminal
use. RX needs incremental source observation, typed application events, durable
workflow transitions, and delivery state integrated with one process. `imsg`
remains evidence and a source of tested low-level code.

The selected attributed-body dependency is GPL-3.0. RX must therefore use a
compatible open-source license while that dependency remains in the binary.

## 3. Design Implications

- The renderer receives typed view models and emits typed commands. It never
  opens Apple or RX databases directly.
- The core is organized around `Conversation`, `Message`, `WorkflowState`, and
  `DeliveryAttempt`, not around CLI commands or provider-neutral records.
- Apple source identity uses stable chat and message GUIDs. Local row IDs are
  cursors, not durable cross-database identity.
- Source content is loaded on demand. RX persists workflow metadata rather than
  mirroring all message bodies.
- Source observation produces domain events such as `MessageReceived`,
  `ConversationChanged`, and `DeliveryVerified`.
- Archive and snooze transitions are transactions in RX’s database. A source
  event can deterministically resurface a conversation.
- All automation is isolated behind a delivery module and tested against both
  success and silent-no-op behavior.
- Packaging targets direct distribution for macOS rather than the App Store.

## 4. When to Revisit

Reconsider this decision when any of the following is true:

- the approved designs require a native control or window behavior Tauri cannot
  reproduce acceptably;
- a supported Apple API replaces direct local-database access;
- a Swift decoder proves simpler and equally correct, removing the Rust bridge
  advantage;
- GPL compatibility conflicts with the intended RX license or distribution;
- source monitoring cannot meet the one-minute wake and near-live inbound
  requirements in the Tauri lifecycle; or
- RX gains a second approved message source and the concrete Apple boundary no
  longer fits the product.
