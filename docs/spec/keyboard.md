# Keyboard Navigation

Last updated: `2026.08.24`

> rx uses a small Vim-style modal model. Navigation keys operate the
> conversation workspace until the user explicitly enters a text field.

## Table of Contents

1. [Principles](#1-principles)
2. [Interaction modes](#2-interaction-modes)
3. [Shortcut map](#3-shortcut-map)
4. [Command behavior](#4-command-behavior)
5. [Focus and event rules](#5-focus-and-event-rules)
6. [Implementation contract](#6-implementation-contract)
7. [Acceptance criteria](#7-acceptance-criteria)

---

## 1. Principles

- Navigation mode is the default on launch and after dismissing an overlay.
- Printable shortcuts never fire while the user is typing or composing text.
- `Escape` always moves one level outward toward Navigation mode.
- A pointer action updates the same selection and focus state as its keyboard
  equivalent. Keyboard and pointer navigation do not create parallel states.
- Every command is available from the command palette even when it also has a
  direct shortcut.
- Selection does not wrap at the beginning or end of a list.
- Shortcut labels use macOS notation in the interface and `Cmd` notation in
  implementation-facing names.

---

## 2. Interaction modes

rx has four interaction modes.

| Mode | Purpose | Entry | Exit |
|---|---|---|---|
| Navigation | Move through conversations, views, and Spaces | Launch; `Escape` from Insert | `i`, `/`, `Cmd-K`, or `g s` |
| Insert | Write in the open conversation's composer | `i` when sending is available; pointer focus in composer | `Escape` |
| Filter | Edit the conversation-list filter | `/` from Navigation; pointer focus in filter | `Escape` |
| Overlay | Use the command palette, Space selector, or another modal surface | Command-specific | `Escape`, selection, or dismissal |

Insert mode is scoped to the open conversation. A draft remains attached to
that conversation if the user leaves Insert mode or changes selection.

The mode is a property of the application shell, not inferred solely from the
DOM focus target. An unexpected focus change must not silently put rx into
Insert mode.

---

## 3. Shortcut map

### 3.1 Navigation mode

| Shortcut | Command | Behavior |
|---|---|---|
| `j` | Select next conversation | Moves one row down and opens that conversation |
| `k` | Select previous conversation | Moves one row up and opens that conversation |
| `i` | Enter Insert mode | Focuses the composer at the saved draft position |
| `Escape` | Clear transient context | Clears an active filter; otherwise remains in Navigation mode |
| `/` | Filter conversations | Focuses the list filter for the current Space and workflow view |
| `1` | Select view 1 | Opens Inbox |
| `2` | Select view 2 | Opens Snoozed |
| `3` | Select view 3 | Opens Archive |
| `4` | Reserved view slot | Unbound until a fourth workflow view is approved |
| `g s` | Go to Space | Opens the Space selector |
| `Cmd-K` | Open command palette | Opens the global command palette |
| `Cmd-1` | Go to All | Selects the aggregate All scope |
| `Cmd-2`…`Cmd-9` | Go to numbered Space | Selects the corresponding user Space in visible order |

`Cmd-2` selects the first user Space, `Cmd-3` selects the second, and so on.
`Unassigned` is available through `g s` and the pointer UI. It does not consume
a numbered Space shortcut. User Spaces beyond the first eight remain available
through `g s` and the command palette.

### 3.2 Insert mode

| Shortcut | Command | Behavior |
|---|---|---|
| `Escape` | Return to Navigation mode | Blurs the composer and preserves the draft and caret position |
| `Cmd-Enter` | Send | Sends the draft when non-empty and sending is available |
| `Cmd-K` | Open command palette | Opens the palette without discarding the draft |
| `Cmd-1`…`Cmd-9` | Change Space | Changes Space scope and preserves the draft |

Unmodified `j`, `k`, `i`, `/`, number keys, and all other printable keys enter
text in Insert mode. `Enter` inserts a line break.

### 3.3 Filter mode

| Shortcut | Command | Behavior |
|---|---|---|
| `Escape` | Apply and return | Keeps the filter query and returns to Navigation mode |
| `ArrowDown` | Select first result | Applies the query and moves selection into the result list |
| `Enter` | Open first result | Opens the first result and returns to Navigation mode |
| `Cmd-A` | Select filter text | Uses the native text-field behavior |
| `Cmd-K` | Open command palette | Opens the palette and preserves the filter query |

When a filter remains active in Navigation mode, `Escape` clears it. Pressing
`/` again returns focus to the filter and selects its current contents.

### 3.4 Overlay controls

The command palette and Space selector use the same controls.

| Shortcut | Command |
|---|---|
| `ArrowDown` or `Ctrl-N` | Select next result |
| `ArrowUp` or `Ctrl-P` | Select previous result |
| `Enter` | Execute the selected result |
| `Escape` | Close without executing |

Closing an overlay restores the mode and logical focus that existed before it
opened. If the underlying conversation disappeared, focus returns to the
conversation list using the selection fallback rules below.

---

## 4. Command behavior

### 4.1 Conversation selection

`j` and `k` change both list selection and the open conversation. The selected
row remains visible. Repeated key events are accepted so holding either key can
traverse the list.

At a list boundary, selection stays on the first or last row. Empty lists keep
focus on the list container and announce the empty state.

rx remembers the last selected conversation for each `(Space, workflow view)`
pair during the application session. When that row is no longer present, rx
selects the nearest surviving row. If there is no prior selection, rx selects
the first row.

### 4.2 Workflow views

Number keys select workflow views by stable visible position. In v0 the mapping
is fixed to `1` Inbox, `2` Snoozed, and `3` Archive. The selected Space does not
change when the workflow view changes.

The design currently shows a possible fourth view, but v0 scope does not define
one. `4` must remain unbound rather than creating an unsupported feature solely
to fill the shortcut slot.

### 4.3 Space selection

`g s` is a two-key chord available only in Navigation mode. Pressing `g` starts
a 750 ms chord window. Pressing `s` within that window opens the Space selector.
`Escape`, timeout, or any other key cancels the chord. A non-matching key is
then processed normally so the chord does not swallow a valid command.

The selector contains, in order:

1. All;
2. user Spaces in their visible, user-defined order; and
3. Unassigned.

`Cmd-1` maps to All. `Cmd-2` through `Cmd-9` map to the first eight user Spaces.
Reordering Spaces updates the user-Space mappings immediately. The Space UI and
command palette show the current number beside each mapped Space.

Changing Space preserves the current workflow view. If that view is empty in
the destination Space, rx shows its empty state rather than switching to Inbox.

### 4.4 Conversation filtering

`/` filters the current conversation list. Its scope is the selected Space and
workflow view. Selecting All before filtering broadens the Space scope; the
filter itself never silently changes scope.

Filtering is incremental. Selection follows the first matching row until the
user explicitly moves it. Clearing the query restores the pre-filter selection
when that conversation is still present.

### 4.5 Command palette

`Cmd-K` is global within the main application window. The palette includes
navigation, Space selection, workflow, and conversation actions. Commands that
cannot run in the current context remain visible but disabled with a short
reason.

Executing a navigation command closes the palette and moves logical focus to
the destination. Executing a modal command such as Snooze closes the palette
and opens that command's surface.

---

## 5. Focus and event rules

Keyboard events are resolved in this order:

1. Preserve macOS text input and active input-method-editor composition.
2. Let the active modal or overlay handle its own keys.
3. Apply global modified shortcuts such as `Cmd-K` and `Cmd-1`…`Cmd-9`.
4. If Insert or Filter mode is active, send printable keys to the text field.
5. Apply Navigation-mode commands and chords.
6. Leave unhandled keys to the platform.

rx must not intercept a printable key when any editable control has focus,
except where the active mode explicitly defines that key with a modifier.
Shortcuts do not fire while an IME composition is active.

Logical selection and DOM focus are separate:

- Navigation mode keeps DOM focus on the conversation list or application
  shell while retaining a selected conversation.
- Insert mode moves DOM focus to the composer.
- Overlay mode traps DOM focus inside the overlay.
- Closing an overlay restores the prior logical focus target.

Every focus target has a visible focus treatment. List selection exposes the
active row with `aria-selected`; overlays use appropriate dialog or combobox
semantics. Native menu items expose the principal commands for discovery and
assistive technology.

---

## 6. Implementation contract

The renderer owns one central command registry and one explicit mode state
machine. Feature components invoke commands from that registry; they do not
install competing document-level shortcut handlers.

Each command declares:

- a stable identifier;
- its label and optional shortcut;
- the modes in which it is available;
- an enablement predicate and disabled reason; and
- its execute function.

The same declarations populate the command palette and macOS menu labels.
Chord state is reset on mode change, window blur, overlay open, or timeout.

Shortcut preferences and remapping are outside v0. Command identifiers must
remain independent of their default keys so remapping can be added later
without changing feature code.

---

## 7. Acceptance criteria

1. Launch places rx in Navigation mode with a deterministic selected row or an
   accessible empty-list focus target.
2. `j` and `k` traverse the current list without wrapping and keep the selected
   row visible.
3. `i` focuses an available composer; `Escape` preserves its draft and returns
   to Navigation mode.
4. Printable navigation keys enter text rather than executing commands in
   Insert and Filter modes.
5. `/` filters only the selected Space and workflow view. Its two-stage
   `Escape` behavior preserves and then clears the query.
6. `1`, `2`, and `3` select Inbox, Snoozed, and Archive without changing Space.
   `4` has no effect until a fourth view is approved.
7. `g s` opens the Space selector only when completed within 750 ms. Failed
   chords do not swallow the following valid key.
8. `Cmd-1` selects All. `Cmd-2` through `Cmd-9` select the first eight user
   Spaces in visible order and update after reorder.
9. `Cmd-K` opens the palette from every mode, and closing it restores the prior
   mode and focus without losing a draft or filter.
10. No application shortcut fires during IME composition.
11. Every shortcut-backed command is available in the command palette and has
    a pointer-accessible equivalent.
12. Automated tests cover mode transitions, event priority, chord timeout,
    list boundaries, selection fallback, Space reordering, draft preservation,
    and filter scope.
