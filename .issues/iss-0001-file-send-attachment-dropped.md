---
id: iss-0001
title: "File send via Messages.app scripting silently drops the attachment"
status: done
priority: high
labels: [platform, delivery, v0-scope-risk]
---

# iss-0001 :: File send via Messages.app scripting silently drops the attachment

On macOS 26.5.1 (25F80), `send (POSIX file …) to participant …` through the
Messages.app scripting interface exits 0 and creates a message row whose
decoded body is only the object-replacement placeholder (`￼`). No row is
added to `attachment` or `message_attachment_join`, no file appears under
`~/Library/Messages/Attachments/`, and the self-chat echo carries no
attachment. Reproduced with `.txt` and `.png` payloads from two source
directories. Text send through the same interface works and verifies.

Evidence: [platform spike findings — spike 3b](../docs/findings/platform-spike.md).

Impact: the v0 scope item "send one or more file attachments"
(docs/v0-scope.md §4.4) has no working supported transport. rx's
verification model correctly reports these sends as failed rather than
falsely confirmed.

Candidate resolutions:

1. Test the Shortcuts.app "Send Message" action with an attachment as an
   alternative supported automation path.
2. Descope file sending from v0; receiving and rendering attachments is
   unaffected.
3. UI automation — excluded by scope (no Accessibility-driven automation).

Decision: descoped from v0 (2026.08.24). Receiving and rendering attachments
stays in scope; file sending returns when a supported transport exists.
