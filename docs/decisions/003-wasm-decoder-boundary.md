# ADR-003 :: WASM Decoder Boundary

Last updated: `2026.08.24`

**Status:** Accepted `2026.08.24`

**Revises:** [ADR-002](002-electron-architecture.md) (decoder boundary only)

> Ship the attributed-body decoder as a WebAssembly module instantiated with
> no imports, returning the structured `DecodedBody` format. The Node-API
> addon becomes the fallback. Everything else in ADR-002 stands.

---

## 1. Decision

- Compile the decoder to `wasm32-unknown-unknown` from a crabstep-based Rust
  crate. No WASI, no host imports: the module cannot reach the filesystem,
  network, or any host API by construction.
- The decoder ABI accepts raw `attributedBody` bytes and returns JSON:
  `{ ok: DecodedBody } | { err: string }` with
  `DecodedBody = { text, spans: [{ start, end, kind, value? }] }`.
- Span offsets are UTF-16 code units, matching JavaScript string indexing and
  Apple's native range encoding — no byte-offset translation layer.
- The Electron main process is the only WASM host. The renderer never
  receives raw payloads.
- The Node-API addon remains the measured fallback if the packaged Electron
  check (spike 4 criterion) fails for WASM.
- The Contacts bridge remains native; WASM cannot call macOS frameworks.

## 2. Rationale

Spike 5b decoded the same 97-payload corpus as the native addon with zero
errors and zero text mismatches, extracted link/mention/style spans, and
returned typed errors on malformed input without trapping. WASM is ~30×
slower (0.06ms per message) — irrelevant at interactive scale.

Over the Node-API addon, WASM removes per-architecture Mach-O artifacts,
universal-binary assembly, and Node ABI coupling; the `.wasm` file ships as
a signed-bundle resource without separate binary signing. The sandbox
guarantee moves from code review to runtime structure.

WASM does not change licensing: crabstep is GPL-3.0-or-later regardless of
artifact format, so the ADR-002 license obligation stands.

`imessage-database` cannot be the WASM dependency (it links rusqlite). The
decoder crate uses crabstep's public API plus a reimplemented attributed
range walk; rich coverage beyond link/mention/style spans (data detectors,
edits, attachments metadata) grows in that crate under fixture tests.

## 3. When to Revisit

- The packaged Electron app cannot instantiate or run the WASM decoder
  acceptably (fall back to the Node-API addon).
- Decoder responsibilities grow to need capabilities WASM cannot express.
- The GPL obligation conflicts with the distribution license.
