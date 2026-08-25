// Automation executor (plan step 10): sends text through Messages.app's
// scripting interface via osascript. Message text and targets travel as
// argv — never interpolated into script source (spec/v0.md §4.4, spike 3a).

import { execFile } from 'node:child_process';

export type SendTarget =
  | { kind: 'chat'; chatGuid: string }
  | { kind: 'handle'; handle: string };

export type AutomationFailure = 'permission-denied' | 'messages-unavailable' | 'automation-error';

export type AutomationResult = { ok: true } | { ok: false; reason: AutomationFailure };

export type SendAutomation = (target: SendTarget, text: string) => Promise<AutomationResult>;

// argv: 1 = chat guid, 2 = text.
const CHAT_SCRIPT = `on run argv
  set theGuid to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    send theText to chat id theGuid
  end tell
end run`;

// argv: 1 = handle, 2 = text. Starting a one-to-one goes through the enabled
// iMessage account; Messages routes to an existing chat when one exists.
const HANDLE_SCRIPT = `on run argv
  set theHandle to item 1 of argv
  set theText to item 2 of argv
  tell application "Messages"
    set theService to first account whose enabled is true and service type is iMessage
    send theText to participant theHandle of theService
  end tell
end run`;

export function runAutomation(target: SendTarget, text: string): Promise<AutomationResult> {
  const script = target.kind === 'chat' ? CHAT_SCRIPT : HANDLE_SCRIPT;
  const argument = target.kind === 'chat' ? target.chatGuid : target.handle;
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-e', script, argument, text],
      { timeout: 20_000 },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true });
        } else {
          resolve({ ok: false, reason: classifyAutomationError(stderr) });
        }
      },
    );
  });
}

/** Map osascript stderr to the typed failure the renderer can explain. */
export function classifyAutomationError(stderr: string): AutomationFailure {
  // errAEEventNotPermitted: the Automation TCC grant is missing or denied.
  if (stderr.includes('-1743') || stderr.includes('Not authorized')) {
    return 'permission-denied';
  }
  // Application not running / not found / Apple event timeouts reaching it.
  if (
    stderr.includes('-600') ||
    stderr.includes('-10810') ||
    stderr.includes("isn't running") ||
    stderr.includes("Can't get application")
  ) {
    return 'messages-unavailable';
  }
  return 'automation-error';
}
