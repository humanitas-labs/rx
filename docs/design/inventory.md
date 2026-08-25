# rx Design Inventory (v0)

Last updated: `2026.08.24`

Plan step 1 deliverable ([v0 plan](../../.plan/v0.md)). Source frames, both
1512×982, confirmed by the user as the full v0 design:

- [RX / Chat (v0)](https://www.figma.com/design/zL4rZa8PPB6rj0KBNiunE7/RX?node-id=48-2191)
  — main window: sidebar conversation list + conversation reader.
- [RX / Chat / Space Selection (v0)](https://www.figma.com/design/zL4rZa8PPB6rj0KBNiunE7/RX?node-id=48-2301)
  — same window with the Space switcher expanded and the rest dimmed.

Frame exports are not committed: the fixtures include personal names, and
release acceptance ([v0 scope §6.3](../spec/v0.md#6-acceptance)) bans personal
content from the repository. Reference the Figma frames directly.

Exit criterion: every design interaction below is **implemented**, **deferred**,
or **decorative**, and every in-scope surface without a frame has a proposed
disposition. No unlabeled control remains.

---

## 1. Screen inventory

### 1.1 Designed screens

| Screen | Frame | Contents |
|---|---|---|
| Main window | 48-2191 | Frameless dark window over the desktop; custom traffic lights; left sidebar (view tabs, filter, conversation list, Space button); right reader (header, thread, composer). |
| Space switcher | 48-2301 | Overlay state of the same window: content dimmed; vertical stack grows upward from the bottom-left Space button — All, Personal, Business, Groups (active), New Space. |

### 1.2 Designed components (frame 48-2191)

Sidebar:

- Traffic lights (custom-drawn, top-left).
- Compose button — circled `square.and.pencil`, top-right of sidebar.
- View tab row — four glyph tabs: `pin`, `inbox` (active), `clock-dashed`
  (Snoozed), `archive`.
- Filter button — `line.3.horizontal.decrease`, right end of the tab row.
- Conversation row — 40 px avatar, name, one-line truncated preview,
  right-aligned relative timestamp (`11:10`, `Yesterday`, `Sunday`),
  hairline divider.
- Row state affordances — 4×32 left-edge active bar; 4×12 left-edge hover
  bar; 8 px unread dot left of the avatar.
- Space button — 32 px circle with a hexagon-cluster glyph (the `All`
  glyph), bottom-left.

Reader:

- Header — centered 40 px avatar, conversation name, `chevron.forward`
  details affordance.
- Date separator — `Today 10:53`, centered.
- Incoming bubble (gray, left), outgoing bubble (blue, right).
- Delivery receipt — `Delivered` under the latest outgoing bubble.
- Overlay scrollbar on the thread.
- Composer — circled `plus` button and a rounded `Message` input.

### 1.3 Designed components (frame 48-2301)

- Dim scrim over the whole window.
- Space rows, bottom-up: `All` (hexagon cluster), `Personal` (home),
  `Business` (briefcase), `Groups` (people; active — filled squircle plus the
  same 4 px left-edge active bar), `New Space` (outlined circle with plus).

### 1.4 In-scope screens with no frame

Everything below is required by [v0 scope §4](../spec/v0.md#4-functional-scope)
but has no designed frame. Proposed dispositions; anything marked *design
needed* should get a frame before its build step.

| Surface | Scope ref | Proposed disposition |
|---|---|---|
| Onboarding / permissions (FDA, Automation, account check) | §4.1 | Design needed before plan step 11; until then a functional plain window with per-permission status + corrective action. |
| Snoozed view | §3.1, §4.2 | Reuse sidebar list layout; timestamp column shows wake time, ordered soonest first. No new frame required. |
| Archive view | §3.1, §4.2 | Reuse sidebar list layout verbatim. No new frame required. |
| Search | §4.2 | No search UI exists in the frames. Propose: the filter button and `⌘F` open an inline search field replacing the tab row; results list reuses row layout. Design needed. |
| Snooze picker | §4.5 | Popover from the row/reader: quick choices + custom date-time. Design needed. |
| Triage controls (archive, snooze, restore, move to Space) | §4.5, §3.6 | No visible per-row controls in the frames. Propose: row context menu + row-hover glyphs + keyboard shortcuts; same actions in a reader header menu. Design needed. |
| New conversation (compose target picker) | §4.4 | Compose button exists; its destination does not. Propose a recipient field (contact, phone, email) above an empty thread. Design needed. |
| Conversation details (chevron target) | §4.3 | Minimal popover: participants, handles, “Open in Messages”. Design wanted, functional fallback acceptable. |
| Space management (create, rename, reorder, delete) | §3.6 | `New Space` row exists; naming, rename, reorder, delete do not. Propose inline name field on create; context menu + drag to reorder. Design needed. |
| Rich thread payloads (attachments, tapbacks, edits, replies, group events, unsupported fallback) | §4.3 | Bubble treatments undesigned. Implement functionally with system-styled treatments; design pass before polish (plan step 10). |
| Delivery pending / failed states | §4.4 | Only `Delivered` is designed. Propose: pending = dimmed bubble + spinner glyph; failed = red note + retry affordance. Design needed. |
| Empty, loading, permission-lost, source-unavailable states | §4.2 | Centered explanatory placeholder per view. Functional first; design pass at step 10. |
| Command palette | [keyboard spec §4.5](../spec/keyboard.md#45-command-palette) | Required surface (`Cmd-K`): every command listed, disabled ones visible with a reason. Design needed; standard palette layout acceptable functionally. |
| Settings | — | Not designed and nothing in v0 scope forces a settings surface; permissions live in onboarding. Deferred unless a concrete setting appears. |

## 2. Interaction matrix — designed controls

Columns: the command it issues, the state transition, its loading state, its
failure state, keyboard access, and v0 disposition
(**implemented** / **deferred** / **decorative**). Keyboard bindings follow the
[keyboard spec](../spec/keyboard.md) (Vim-style modal model; Navigation mode is
the default). Commands without a direct binding are reachable through the
`Cmd-K` command palette.

| # | Control | Command | State transition | Loading | Failure | Keyboard | Disposition |
|---|---|---|---|---|---|---|---|
| 1 | Traffic lights | Close / minimize / zoom window | Standard macOS window state | — | — | `⌘W`, `⌘M` | Implemented |
| 2 | Compose button | `start_conversation` flow | Opens new-conversation surface (§1.4) | — | — | Command palette | Implemented |
| 3 | `pin` tab | — | — | — | — | `4` reserved, unbound ([keyboard spec §4.2](../spec/keyboard.md#42-workflow-views)) | **Deferred** — pinned conversations are not in v0 scope (open question Q1); glyph hidden in v0 |
| 4 | `inbox` tab | Select Inbox view | List shows `inbox` state in the selected Space | List skeleton on first load | Source-unavailable placeholder | `1` | Implemented |
| 5 | `clock-dashed` tab | Select Snoozed view | List shows `snoozed`, soonest wake first | Same | Same | `2` | Implemented |
| 6 | `archive` tab | Select Archive view | List shows `archived` | Same | Same | `3` | Implemented |
| 7 | Filter button | Enter Filter mode (Q2) | Inline filter field; list becomes result set, scoped to selected Space + view | Incremental query | Empty-result placeholder | `/`; two-stage `Esc` | Implemented as filter entry |
| 8 | Conversation row (click) | `open_conversation` | Row gains active bar; reader loads latest 50; rx seen watermark advances; unread dot clears | Thread skeleton; UI never blocks (§6.1-3) | Inline reader error + retry | `j`/`k` select and open; no wrap | Implemented |
| 9 | Row hover | — | 4×12 hover bar; reveals triage glyphs (§1.4 proposal) | — | — | — | Implemented |
| 10 | Unread dot | — | Set by inbound past seen watermark; cleared on open | — | — | — | Implemented (display) |
| 11 | Row context menu (proposed, undesigned) | `archive` / `snooze` / `restore` / `assign_space` | Persisted before row leaves view (§4.5) | Row stays until write confirmed | Toast + row remains | Command palette (no direct bindings in the keyboard spec yet — Q7) | Implemented |
| 12 | Space button | Open Space switcher | Frame 48-2301 overlay state | — | — | `g s` chord | Implemented |
| 13 | Reader header name + chevron | Open conversation details | Details popover (§1.4) | — | — | Command palette | Implemented (minimal) |
| 14 | Message bubbles | — | — | Lazy-load older on scroll-top | Unsupported-payload fallback bubble | `PgUp`/`PgDn` scroll | Implemented (display) |
| 15 | `Delivered` receipt | — | Verified-sent per delivery verification model | Pending state (undesigned) | Failed state + retry (undesigned) | — | Implemented (display) |
| 16 | Thread scrollbar | Scroll thread | — | — | — | Arrows / page keys | Implemented |
| 17 | Date separator | — | — | — | — | — | Decorative |
| 18 | Composer `plus` button | — | — | — | — | — | **Deferred** — its evident purpose is attachment send, which is descoped ([iss-0001](../../.issues/iss-0001-file-send-attachment-dropped.md)); hidden in v0 |
| 19 | Message input | `send_text` | Optimistic pending bubble → verified/failed; verified send from Archive/Snoozed restores to Inbox (§4.4) | Pending bubble | Failed bubble + retry; prior workflow state unchanged | `i` enters Insert mode; `Cmd-Enter` sends; `Enter` inserts a line break; `Esc` back to Navigation | Implemented |
| 20 | Message input (typing) | Draft persistence | Draft survives while conversation open (§4.4) | — | — | — | Implemented |
| 21 | Overlay scrim (48-2301) | Close switcher | Return to frame 48-2191 state | — | — | `Esc` | Implemented |
| 22 | `All` row | Select All aggregate | Lists aggregate across Spaces; search scope broadens (§3.6) | List refresh | — | `Cmd-1` | Implemented |
| 23 | Space row (`Personal`, `Business`, …) | `select_space` | Active squircle + edge bar move; tabs/list/search rescope | List refresh | — | `Cmd-2`…`Cmd-9` in visible order; `g s` selector | Implemented |
| 24 | Space row context menu (proposed, undesigned) | `rename_space` / `reorder_space` / `delete_space` | Per plan step 5 transitions | — | Toast on write failure | — | Implemented |
| 25 | `New Space` row | `create_space` | Inline name field → new Space appears in stack | — | Duplicate-name inline error | — | Implemented |
| 26 | `Unassigned` entry | `select_space(unassigned)` | Missing from the frame (Q3); required by §3.6 | — | — | `g s` selector only; no numbered shortcut ([keyboard spec §4.3](../spec/keyboard.md#43-space-selection)) | Implemented — must be added to the design |

## 3. Reconciliation — design ↔ scope

Open questions for the design (take back into Figma); recommendations inline:

- **Q1 — `pin` tab (48-2191 only). Resolved 2026.08.24:** pinning is deferred
  post-v0 and the glyph is left out of the v0 build. The
  [keyboard spec §4.2](../spec/keyboard.md#42-workflow-views) already treats
  the fourth view as unapproved (`4` stays unbound).
- **Q2 — Filter button semantics.** No popover or field is designed. The
  keyboard spec defines `/` Filter mode over the current list; scope §4.2 also
  requires search across decoded message text. Recommend: this control is the
  visible entry to Filter mode, and whether full-text search shares this
  surface or lives in the command palette needs one explicit decision.
- **Q3 — `Unassigned` missing from the switcher.** Scope §3.6: unassigned
  conversations live in `Unassigned` and the switcher covers it. The frame
  shows only user Spaces, and the
  [keyboard spec §4.3](../spec/keyboard.md#43-space-selection) already places
  `Unassigned` last in the selector order. Recommend: add an `Unassigned` row
  above `New Space`, always visible.
- **Q4 — `Groups` Space.** The frame's example Spaces are Personal, Business,
  Groups. Treated as fixture content, not a mandated default set; v0 seeds no
  Spaces (everything starts `Unassigned`).
- **Q5 — Frame layout divergence.** In 48-2301 the view tabs sit small in the
  window title row and there is no `pin`; in 48-2191 they sit in their own row
  below it. Treat 48-2191 as canonical for sidebar layout; confirm.
- **Q6 — Composer `plus`.** Attachment send is descoped (iss-0001). Recommend
  removing the button from the v0 frame rather than shipping a dead control.
- **Q7 — Keyboard gaps.** The [keyboard spec](../spec/keyboard.md) defines the
  modal model and bindings, resolving the general map. Still unbound: direct
  archive/snooze/restore keys (palette-only today) and a compose shortcut.
  The frames show no mode indicator; decide whether Navigation/Insert/Filter
  state gets a visible treatment.
- **Q8 — Triage affordances.** Archive/snooze/restore/move have no visible
  controls in either frame. The context-menu + hover-glyph + shortcut proposal
  in §1.4/§2 needs a design pass; the behavior itself is unambiguous in scope.

Nothing in the frames contradicts the behavioral model (§3), the source
boundary (§5), or acceptance (§6). The gaps are missing surfaces, not
conflicting ones.
