# Platform Spike Findings

Last updated: `2026.08.24`

Status: spikes 1–3 executed; spikes 4–6 pending.

Environment: macOS 26.5.1 (25F80), Messages.app iMessage account active,
terminal granted Full Disk Access and Messages Automation permission.
Spike code: [`spikes/apple-platform/`](../../spikes/apple-platform/). All
spike output is statistics and rx-generated test messages only; no personal
content was printed or stored.

## Spike 1 — read-only open and decode (PASS)

Opened `~/Library/Messages/chat.db` via `imessage-database` 4.2.0
(`get_connection`, read-only flags).

- A write attempt fails with `attempt to write a readonly database`.
- Open: ~3ms. Latest-100-conversations aggregate query: ~148ms (unindexed
  `GROUP BY chat_id` over ~45k messages — acceptable, optimizable with a
  cursor-bounded variant).
- Fetch + decode of the 100 latest per-chat messages: ~2.3ms total.
- Body sources: 15 plain `text` column, 82 decoded from `attributedBody`
  (typedstream), 3 non-decodable.
- The 3 non-decodable rows are expected categories: `item_type=3` group
  events (no body exists) and `balloon_bundle_id` app messages
  (payments/stickers). Both map to the planned typed fallback items.

Implication: attributed-body decoding is mandatory for ~85% of current
message bodies. The plain `text` column alone is useless for a modern inbox.

## Spike 2 — incremental observation without full polling (PASS)

Strategy validated: remember `MAX(message.ROWID)` as a cursor, watch
`chat.db-wal` size+mtime at 250ms, and on change run one bounded query
(`WHERE m.ROWID > ?cursor GROUP BY chat_id`) emitting affected chat GUIDs.

- New-message detection landed within one 250ms tick of the WAL change.
- The bounded catch-up query costs 0.2–4ms.
- WAL changes with no new message rows occur (other table writes); the
  bounded query correctly returns nothing.
- A real `fs` watcher (FSEvents/kqueue) should replace the stat loop in the
  app; a bounded poll fallback (e.g. every 30s) remains cheap insurance.

Caveat: ROWID cursors are local-incremental only, per plan/ADR identity
rules. Message deletion or Messages database rebuild requires cursor reset
logic (detect `MAX(ROWID)` < cursor).

## Spike 3a — text send + source verification (PASS)

Sent a nonce text to the user's own self-chat via
`osascript … send <text> to participant <handle> of <iMessage account>`,
passing text as an argument (no script interpolation).

- Two source rows appear in the intended chat GUID (`any;-;+…` self chat):
  the outbound copy (`is_from_me=1, is_sent=1`) and the self-chat inbound
  echo.
- **Finding:** the outbound row's body lands in `attributedBody`, not the
  plain `text` column. Delivery verification cannot match on `text =`;
  it must match on (pre-send cursor, intended chat, `is_from_me=1`,
  decoded body or time window).
- Detection of the sent row via the spike-2 observer worked end-to-end.

## Spike 3b — file send via scripting interface (FAIL — v0 scope risk)

Sent files (`.txt`, then a valid `.png`, from both `/private/tmp` and
`~/Downloads`) with `send (POSIX file …) to participant …`.

- `osascript` exits 0 every time.
- Message rows are created whose decoded body is only the object-replacement
  placeholder (`￼`).
- No row is ever added to `attachment` or `message_attachment_join`
  (checked out to ~60s), no file appears under
  `~/Library/Messages/Attachments/`, and the self-chat echo also carries no
  attachment. The attachment is silently dropped.

This reproduces the known AppleScript file-send regression on recent macOS.
It is the exact "automation exit success without a source record" failure
mode the plan treats as failure — the verification model catches it.

Consequences for v0:

1. Text send is dependable and verifiable. File send through the supported
   scripting interface is broken on macOS 26.5.1.
2. Options: (a) test the Shortcuts.app "Send Message" action with an
   attachment as an alternative supported automation path; (b) descope
   file sending from v0 (receive/render attachments still works — that is
   read-side); (c) UI automation — already excluded by scope.
3. Decision owner: user. Until decided, compose/delivery work (plan step 10)
   should treat file send as at-risk.

Residue: the self-chat now contains the spike test messages (two nonce
texts and four placeholder messages). They are harmless; delete them in
Messages.app if unwanted.

## Spike 4 — packaged signed Electron permissions (PENDING)

Requires the user present: granting Full Disk Access and Automation to the
packaged bundle identity involves interactive TCC dialogs.

## Spike 5 — decoder-only Node-API addon (PASS, Node-side)

Built `decoder-addon/`: a Rust `cdylib` using napi-rs 2 exposing
`decodeBodyText(Buffer) -> string | null`, throwing typed errors on
malformed streams.

- Loads directly in Node 26 as `require('./decoder.node')`.
- Single real payload decode: ~0.18ms. Batch of 97 real latest-message
  payloads: 95 text, 2 placeholder-only, 0 failures, 0.19ms total.
- The decoder shape from ADR-002 holds: bytes in, text out, no database or
  filesystem access. Remaining sub-check (loading the addon under the
  packaged, signed Electron identity) folds into spike 4.

Two licensing/architecture facts discovered:

1. The typedstream deserializer is `crabstep` (also GPL-3.0), a `no_std`,
   `forbid(unsafe)` crate — a cleaner dependency for the production addon
   than all of `imessage-database`.
2. `imessage-database`'s rich-range walk (`parse_body_typedstream` —
   mentions, links, edits, per-part components) is `pub(crate)` and not
   reachable from outside the crate. The production decoder must either
   reimplement that walk on crabstep's public API, vendor the module, or
   upstream a visibility change. Plain-text extraction needs none of that.

## Spike 5b — decoder as WASM with structured output (PASS, Node-side)

Built `decoder-wasm/`: crabstep-only Rust crate compiled to
`wasm32-unknown-unknown`, 60KB module, instantiated with **zero imports**
(no WASI, no host functions — sandboxing is structural). ABI: bytes in,
length-prefixed JSON out: `{ ok: { text, spans } } | { err }`, span offsets
in UTF-16 code units (JavaScript string indexing; also Apple's native range
encoding, so no byte mapping exists anywhere).

- Same 97-payload corpus: 97 ok, 0 errors, 0 text mismatches against the
  native addon.
- 8 corpus messages carry spans; link span verified with URL value and
  correct offsets. Kinds implemented: link, mention, bold, italic,
  underline/strikethrough as `other`.
- Batch: 6.1ms WASM vs 0.19ms native (~30×). At 0.06ms per message the
  penalty is irrelevant.
- Malformed inputs (empty, garbage, 4KB of 0xFF) return typed
  `{"err": …}` — no traps, no crashes.
- `imessage-database` cannot be the WASM dependency (links rusqlite); the
  crate reimplements the attributed range walk on crabstep's public API
  (~60 lines). crabstep is GPL-3.0 either way — WASM changes the artifact
  format, not the license.

Decision recorded in [ADR-003](../decisions/003-wasm-decoder-boundary.md):
WASM is the default decoder boundary; the Node-API addon is the fallback.
Remaining criterion — instantiation under the packaged signed Electron app —
folds into spike 4 and is low-risk since no native module loading is
involved.

## Spike 6 — Contacts framework from packaged Electron (PENDING)

Requires the packaged app from spike 4 (Contacts TCC prompt is granted per
bundle identity).
