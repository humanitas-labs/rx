# ADR-004 :: SQLite Access Through node:sqlite

Last updated: `2026.08.24`

**Status:** Accepted `2026.08.24`

> Use the Node.js built-in `node:sqlite` module for all SQLite access — the
> read-only Apple Messages database and the rx workflow database — instead of
> a native dependency such as better-sqlite3.

---

## 1. Decision

- All SQLite access in the main process goes through `node:sqlite`
  (`DatabaseSync`).
- No native SQLite Node module is added to the dependency tree.
- The Apple source module wraps the handle in a read-only reader interface;
  no write handle to Apple databases exists anywhere.

## 2. Rationale

Verified on this repository: `node:sqlite` opens, queries, and writes
correctly inside Electron 38 (Node 22.22, experimental warning only) and runs
stable in Node 26 where vitest executes.

With the decoder already WASM (ADR-003), this leaves rx with zero native Node
modules. The alternative, better-sqlite3, is proven in Electron but compiles
per ABI: the packaged app needs an Electron-ABI build while tests need a
Node-ABI build of the same hoisted module — a permanent source of rebuild
friction. `node:sqlite` has one implementation in both runtimes, needs no
rebuild step, and keeps `pnpm test` and the packaged app on identical code
paths.

The cost is that `node:sqlite` is flagged experimental in Node 22. The API
surface rx uses (`DatabaseSync`, `prepare`, `get`/`all`, `readOnly` open) is
the stable core that Node 24+ ships unflagged; the Electron version is pinned,
so the runtime cannot drift under us.

## 3. Design Implications

- Electron upgrades must re-run the `node:sqlite` probe before landing.
- Query code stays synchronous (`DatabaseSync`); long scans must be bounded
  by the module contract (plan step 4), not by driver async-ness.
- If a future Electron drops or breaks `node:sqlite`, the reader interface is
  the seam where a native driver would slot in.

## 4. When to Revisit

- An Electron upgrade whose Node runtime removes or regresses `node:sqlite`.
- Measured query latency that requires features `node:sqlite` lacks.
