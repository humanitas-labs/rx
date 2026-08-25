# v0 dogfood record

Operational test record for the acceptance criteria in
[docs/spec/v0.md §6](../spec/v0.md#6-acceptance). Criteria are predeclared;
observations are recorded against them, not adjusted to fit them. Only
v0-blocking failures are fixed before a repeat run.

Build under test: _fill in version + commit_.

## 1. Behavioral acceptance (spec §6.1) — clean-install checks

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Permission onboarding reaches a working inbox without terminal commands | ☐ | |
| 2 | 100 most recent conversations load with names and recent content | ☐ | |
| 3 | Opening a conversation renders its latest 50 messages without blocking the UI | ☐ | |
| 4 | A text sent to an existing conversation is verified in Apple's source data | ☐ | |
| 5 | Archive survives restart; resurfaces only after a later inbound message | ☐ | |
| 6 | Snooze survives restart; wakes within one minute; resurfaces early on inbound | ☐ | |
| 7 | Search finds text stored in the attributed-body representation | ☐ | |
| 8 | 1:1 and group conversations usable while Messages.app is not frontmost | ☐ | |
| 9 | rx never opens an Apple-owned database with write access | ☐ | |
| 10 | Verified send from Archive/Snoozed restores to Inbox; failed send does not | ☐ | |
| 11 | Spaces: create/rename/reorder; moves keep state; Unassigned and All correct | ☐ | |

## 2. Operational acceptance (spec §6.2) — one working day

rx as the primary Messages surface for one full working day. The test fails on
any of:

- a missed actionable inbound message;
- an incorrect recipient;
- a false send confirmation;
- lost triage state;
- needing a parallel reminder system.

| Field | Value |
|---|---|
| Date | |
| Hours covered | |
| Conversations triaged | |
| Sends (verified / failed) | |
| Failures against the list above | |
| Verdict | ☐ pass ☐ fail |

Observations (including non-blocking annoyances, for the post-v0 queue):

- _…_

## 3. Release acceptance (spec §6.3)

| Check | Result | Notes |
|---|---|---|
| New user can install and run from repository instructions (README) | ☐ | |
| Permission model and local-data behavior documented plainly (docs/privacy.md) | ☐ | |
| No personal message content in fixtures, logs, screenshots, or the repository | ☐ | |
| Signed + packaged, or unsigned-development limitation stated | ☐ | Development-signed; limitation stated in README |

## Run log

### Run 1 — _date_

_Record results here. If it fails, list the v0-blocking fixes made, then
repeat as Run 2._
