# rx Development

Last updated: `2026.08.24`

## Toolchain

- macOS 15+ on Apple silicon (development machine: macOS 26).
- Node.js 22+ and pnpm 10.
- Rust stable with the `wasm32-unknown-unknown` target
  (`rustup target add wasm32-unknown-unknown`).

## Commands

All from the repository root:

| Command | Effect |
|---|---|
| `pnpm install` | Install every workspace package. |
| `pnpm dev` | Run the desktop app with hot reload. |
| `pnpm typecheck` | Strict TypeScript across all packages. |
| `pnpm test` | Unit tests (vitest) across all packages; builds the WASM decoder first where needed. |
| `pnpm test:rust` | Rust tests for the decoder crate. |
| `pnpm lint` / `pnpm lint:rust` | eslint; clippy with warnings as errors. |
| `pnpm build` | Build all packages and app bundles. |
| `pnpm package` | Build the Contacts helper, then package the signed macOS app into `apps/desktop/release/`. |
| `pnpm --filter @rx/desktop build:contacts` | Compile and unsigned-strip `rx-contacts` (electron-builder signs it with the app). |

## Workspace layout

```text
apps/desktop/            Electron app: src/main (privileged), src/preload
                         (the narrow bridge), src/renderer (sandboxed React)
packages/contract/       IPC command/event schemas (zod) — the only place
                         channels are defined
packages/core/           pure domain model and workflow transition rules
packages/apple-body-decoder/  Rust→WASM decoder boundary (ADR-003) + TS loader
packages/apple-contacts/ Contacts bridge interface + fallback resolver
```

Imports within a package use the `@/` alias to its source root; cross-package
imports use the `@rx/*` workspace names. Tests live in each package's `tests/`
directory, never in `src/`.

Dependency direction is one-way: `renderer → contract ← main → core`. The
renderer never imports `core`, Node, or Electron APIs. `contextIsolation` and
the sandbox stay enabled; the preload exposes named validated methods only.

## Permissions

Development and packaged builds will progressively require:

- **Full Disk Access** — read `~/Library/Messages/chat.db` (read-only).
- **Automation (Messages)** — send messages through Messages.app.
- **Contacts** — resolve handles to names via the Contacts framework.

TCC grants attach to the bundle identity (`sh.rx.desktop`); the packaged app
and your terminal hold separate grants. Grant them in System Settings →
Privacy & Security when prompted.

Signing uses the local Apple Development certificate (`type: development` in
`apps/desktop/electron-builder.yml`). Electron fuses are flipped at package
time (no `runAsNode`, no `NODE_OPTIONS`/`--inspect` injection, asar-only code
loading).

### Distribution signing (pending a Developer ID certificate)

When a Developer ID Application certificate exists, in
`apps/desktop/electron-builder.yml`:

1. set `mac.type: distribution` (electron-builder picks up the Developer ID
   identity from the keychain, or set `mac.identity` explicitly);
2. add notarization: `mac.notarize: true` with
   `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` in the
   environment (or an App Store Connect API key);
3. `pnpm package` then produces a notarized DMG in `apps/desktop/release/`
   that Gatekeeper accepts on other Macs.

Until then, builds run only on the machine that produced them, and TCC
grants may need re-granting after rebuilds (grants follow the signing
identity).

## Fixtures

Fixtures reproduce Apple schema and payload *shapes* only — synthetic
conversations, synthetic handles, synthetic typedstream bytes. Never copy
personal messages, real contact handles, chat identifiers, or database rows
into fixtures, tests, logs, or screenshots (spec/v0.md §6.3). Spike code
follows the same rule and emits statistics only.
