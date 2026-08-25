// Permission explanation and detection before any content access (plan step
// 7, spec/v0.md §4.1). Every state is actionable without the terminal:
// deep-link to the right System Settings pane plus a recheck. App.tsx polls
// capabilities, so granting access flips to the shell automatically.

import type { CapabilitiesView } from '@rx/contract';

export function Onboarding({
  capabilities,
  onRecheck,
}: {
  capabilities: CapabilitiesView;
  onRecheck: () => void;
}) {
  const fda = capabilities.database;
  const drift = capabilities.missingTables;

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h1>rx</h1>
        <p className="lede">
          rx reads your Messages conversations directly on this Mac. Nothing leaves the machine.
        </p>

        <PermissionRow
          ok={fda === 'ok'}
          title="Full Disk Access"
          detail={fdaDetail(fda)}
        >
          {fda !== 'ok' && (
            <>
              <button
                className="btn primary"
                onClick={() =>
                  void window.rx.invoke('app.openPermissionSettings', { pane: 'full-disk-access' })
                }
              >
                Open System Settings
              </button>
              <button className="btn" onClick={onRecheck}>
                Check again
              </button>
            </>
          )}
        </PermissionRow>

        <PermissionRow
          ok={drift.length === 0}
          title="Messages database"
          detail={
            drift.length === 0
              ? 'The Messages database has the structure rx expects.'
              : `This macOS version stores Messages differently than rx expects ` +
                `(missing: ${drift.join(', ')}). rx cannot read it safely — please report this.`
          }
        />

        <PermissionRow
          ok={capabilities.messagesAppPresent}
          title="Messages.app"
          detail={
            capabilities.messagesAppPresent
              ? 'Messages.app is available for sending.'
              : 'Messages.app was not found; rx can read history but not send.'
          }
        />

        <PermissionRow
          ok={null}
          title="Automation"
          detail="macOS will ask for permission to control Messages the first time you send. Nothing to do now."
        />
      </div>
    </div>
  );
}

function PermissionRow({
  ok,
  title,
  detail,
  children,
}: {
  /** null = informational row with no state. */
  ok: boolean | null;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="perm-row">
      <div className="perm-status">{ok === null ? '·' : ok ? '✓' : '●'}</div>
      <div>
        <div className="perm-title">{title}</div>
        <div className="perm-detail">{detail}</div>
        {children ? <div className="perm-actions">{children}</div> : null}
      </div>
    </div>
  );
}

function fdaDetail(state: CapabilitiesView['database']): string {
  switch (state) {
    case 'ok':
      return 'rx can read the Messages database.';
    case 'permission-denied':
      return 'Grant rx Full Disk Access in System Settings → Privacy & Security, then relaunch rx from the same place you normally open it.';
    case 'not-found':
      return 'No Messages database was found for this user. Open Messages.app once so macOS creates it.';
    case 'unreadable':
      return 'The Messages database exists but could not be opened. Check disk permissions and try again.';
  }
}
