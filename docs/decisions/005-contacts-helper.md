# ADR-005 :: Contacts Access Through a Signed Swift Helper

Last updated: `2026.08.24`

**Status:** Accepted `2026.08.24`

> Resolve Apple Messages handles through a bundled, signed Swift helper over
> `CNContactStore`. Keep the helper read-only, short-lived, and outside the
> Electron renderer.

---

## 1. Decision

- Build `rx-contacts` from Swift as part of development and packaging.
- Use Apple’s supported Contacts framework. Do not read the private Address
  Book database.
- Spawn the helper from the Electron main process. The helper accepts no
  arguments, requests Contacts permission, emits one JSON snapshot, and exits.
- Parse and validate the snapshot in `packages/apple-contacts`. Keep the
  resulting handle-to-name index in memory only.
- Resolve phone numbers by normalized digits and last-ten-digit fallback;
  resolve email addresses case-insensitively.
- Fall back to Messages display names and raw handles when permission is denied,
  the helper is unavailable, or a handle has no matching contact.
- Include `NSContactsUsageDescription` on the packaged application. Strip the
  Swift linker signature, then let electron-builder sign `rx-contacts` with
  the same identity as the outer app.

## 2. Rationale

Contacts access requires a native macOS framework call. A Node-API addon would
place another architecture- and ABI-sensitive module inside Electron after
ADR-003 and ADR-004 removed that requirement from decoding and SQLite. A small
Swift executable uses the platform framework directly and has no Node ABI.

The helper is a capability boundary, not an application service. It has no
database, workflow, Messages automation, UI, or network responsibility. The
main process retains orchestration and the renderer receives only resolved
display names through the existing validated contract.

Loading the address book once avoids one helper invocation per conversation.
The snapshot stays inside the parent process pipe and in-memory index. rx does
not persist contact cards or names to its workflow database.

## 3. Design Implications

- Packaging must build and sign `rx-contacts` for each supported architecture.
- `swiftc` always linker-signs ad-hoc. The build script removes that
  signature. electron-builder then signs `Contents/Resources/rx-contacts`
  with the app identity and inherited entitlements. Do not pre-sign the
  helper and do not `signIgnore` it.
- The packaged bundle identity owns the user-facing Contacts permission flow.
- Contact loading never blocks conversation reads. Raw handles render first if
  necessary, then the main process emits a refresh after the snapshot settles.
- A denied permission is remembered for the process lifetime. A transient
  helper failure may retry on the next resolve request.
- Tests use synthetic contact cards and never read or print the user’s address
  book.

## 4. When to Revisit

- macOS does not attribute the Contacts prompt or grant reliably to the
  packaged rx identity;
- large address books exceed the helper buffer or produce unacceptable startup
  cost;
- rx needs incremental contact updates while it is running; or
- Electron gains a stable, supported Contacts bridge that removes the helper
  without weakening isolation.
