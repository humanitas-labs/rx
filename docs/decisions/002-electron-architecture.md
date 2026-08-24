# ADR-002 :: Electron Application Architecture

Last updated: `2026.08.24`

**Status:** Accepted `2026.08.24`

**Supersedes:** [ADR-001](001-application-architecture.md)

**Revised by:** [ADR-003](003-wasm-decoder-boundary.md) (decoder boundary: WASM default, Node-API fallback)

> Build rx as an Electron application with a TypeScript main process, a narrow
> preload contract, and a React renderer. Keep rx’s product logic in TypeScript
> and isolate Apple-specific decoding and Contacts access behind small,
> replaceable native boundaries.

---

## 1. Decision

- Use Electron for the macOS application shell.
- Use React and TypeScript for the renderer.
- Put Apple database access, source observation, automation, workflow state,
  and application orchestration in the Electron main process and shared
  TypeScript packages.
- Expose an explicit, typed preload API. Do not give the renderer Node access,
  filesystem access, shell access, or raw IPC.
- Open Apple-owned SQLite databases read-only.
- Store rx-owned state in a separate SQLite database under the application data
  directory.
- Keep attributed-body decoding behind a `BodyDecoder` interface. Prefer a
  narrow Rust Node-API addon if the platform spike proves it can accept the raw
  payload without owning the rest of the Apple source module.
- Resolve contact handles through Apple’s supported Contacts framework behind a
  separate native bridge. Fall back to Messages display names and raw handles.
- Use a bundled helper process only if the decoder cannot be isolated safely as
  a Node-API addon. Do not make a helper the default application architecture.
- Send through the Messages.app scripting command and verify the resulting
  source record.
- Define rx domain types independently of the existing `imsg` CLI.
- Do not introduce a generic provider abstraction in v0.

## 2. Rationale

Electron matches the intended application architecture and keeps the product,
workflow, and interface in one language. The main process is already the right
security boundary for privileged local operations. The renderer can remain a
design-focused web application without access to personal message storage.

The main technical exception is Apple’s attributed-body format. Most current
message bodies are not available as plain text. A proven Rust decoder exists,
but that fact does not justify moving rx’s application core into Rust. A narrow
Node-API module keeps native code limited to decoding and leaves source queries,
workflow transitions, IPC, and delivery orchestration in TypeScript. A second
small bridge uses the supported Contacts framework instead of coupling rx to
the private Address Book database schema.

Tauri was considered first. It would make the proven Rust parser easy to embed,
but it would also make Rust the application boundary mainly because one payload
format is inconvenient. The user selected Electron, and the narrower native
boundary better reflects the product’s actual needs.

A bundled Rust sidecar remains a fallback. It provides process isolation and
can reuse more existing parsing code, but introduces lifecycle, protocol,
packaging, and crash-recovery work. It is justified only if a decoder-only
Node-API module proves infeasible.

Using `imsg` as a subprocess or service remains rejected. Its CLI query shapes,
confirmation model, and invocation lifecycle were designed for terminal use.
rx requires incremental events, durable workflow transitions, and a stable
typed application contract.

The current attributed-body decoder dependency is GPL-3.0. rx must use a
compatible open-source license while code derived from or linked to that
dependency remains in the distributed application.

## 3. Design Implications

- The main process is the only layer allowed to access Apple data, the rx
  database, Messages automation, native modules, and operating-system APIs.
- `contextIsolation` and the sandbox remain enabled. `nodeIntegration` remains
  disabled in the renderer.
- Preload exposes named methods and subscribed events. It never exposes
  `ipcRenderer` directly.
- Runtime payloads crossing IPC are schema-validated in both directions.
- The core is organized around `Conversation`, `Message`, `WorkflowState`, and
  `DeliveryAttempt`, not CLI commands or provider-neutral records.
- Apple source identity uses stable chat and message GUIDs. Local row IDs are
  incremental cursors rather than durable cross-database identity.
- Source content is loaded on demand. rx persists workflow metadata rather than
  mirroring message bodies.
- Native bridges have no workflow, automation, application-state, or UI
  responsibility. The decoder receives payload bytes; the Contacts bridge
  receives bounded lookup requests.
- Packaging must build and sign the Electron application and each bundled
  native artifact for every supported Mac architecture.
- Distribution targets signed direct download rather than the App Store.

## 4. When to Revisit

Reconsider this decision when any of the following is true:

- the packaged Electron app cannot obtain or retain the required Full Disk
  Access and Automation permissions reliably;
- the approved designs require native window or control behavior Electron
  cannot reproduce acceptably;
- the attributed-body decoder cannot be isolated as a safe Node-API addon and a
  helper process materially compromises reliability;
- GPL compatibility conflicts with the intended license or distribution;
- Electron’s resource cost prevents rx from functioning as an always-running
  daily client; or
- Apple exposes a supported Messages framework that materially changes the
  source and delivery boundary.
