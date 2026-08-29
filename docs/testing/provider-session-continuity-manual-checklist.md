# Session continuity manual test

Started: 2026-08-29

Use this as a running checklist. Mark each step Pass, Fail or Blocked, then add
short notes underneath. We will finish the pass before fixing non-blocking
issues.

Use disposable sessions for Resume, stopping Herdr and database-reset tests.

## Setup

- Observatory commit:
- Test database:
- Test workspace:
- Claude Code version:
- Codex version:

For a disposable database:

```sh
AO_DB_PATH=/private/tmp/ao-manual-continuity.sqlite bun run start
```

## Checklist

### 1. Open Session import

- [x] Pass
- [ ] Fail
- [ ] Blocked

Choose `Session import` in the masthead. Check that Claude Code and Codex
conversations appear there even when they are not currently running in Herdr.

Notes: the original combined Inbox list passed discovery but failed at scale.
Retest the dedicated Session import lens after FIND-001.

Post-fix retest: [x] Pass / [ ] Fail

### 2. Check the two queues make sense

- [ ] Pass
- [x] Fail
- [ ] Blocked

Session import should contain provider conversations not yet tracked by
Observatory. `Work awaiting a home` should contain tracked Agents that have no
Goal. Provider conversations and unidentified Herdr executions should not look
like the same kind of object.

Notes: `Work awaiting a home` currently combines provider sessions available to
import with Herdr-observed Agents. The distinction is unclear, and the panel is
too small for the provider catalogue.

Post-fix retest: [x] Pass / [ ] Fail

### 3. Import one dormant session

- [x] Pass
- [ ] Fail
- [ ] Blocked

Choose a destination Goal and use Add to Goal on a disposable provider session.
It should create exactly one Agent, remove that conversation from Session
import, close the catalogue and focus the Agent on its Goal in Atlas. Separately
check that Import unassigned explicitly says the Agent will go to Inbox and
that it appears there exactly once.

Notes: the original Track action succeeded but looked as though the card merely
moved. Retest the visible Goal destination and the explicit unassigned route
after FIND-005.

Post-fix retest: [x] Pass / [ ] Fail

### 4. Inspect the imported Agent

- [ ] Pass
- [x] Fail
- [ ] Blocked

Check its provider, lifecycle, continuity, repository, branch and workspace.
Repository information should not contradict itself. The Agent ID, provider
session ID and current Herdr execution ID should be available when applicable.

For Codex, confirm Session import does not list internal Guardian, compaction or
subagent sessions as resumable conversations.

Notes: the Claude Code `synthetic-alerting` Agent resolved repository
`example/synthetic-alerting` and branch `main` in Code status, but the lower
inspector facts also showed Repository and Branch as `Unknown`. The inspector
does not currently show the Agent/provider session/execution IDs needed to
verify reconciliation.

Post-fix retest: [x] Pass / [ ] Fail

### 5. Assign it to a Goal

- [x] Pass
- [ ] Fail
- [ ] Blocked

It should move into the selected Goal without creating another Agent or losing
its provider-session identity.

Notes: assigning the tracked Agent to a Goal works as expected.

### 6. Resume the dormant session

- [x] Pass
- [ ] Fail
- [ ] Blocked

Resume should create one new Herdr execution containing the exact conversation.
The Observatory Agent, Goal and provider session IDs should remain unchanged.
Open terminal should attach to that execution.

Run once for:

- [x] Claude Code
- [x] Codex

Notes: Resume successfully opened both Claude Code and Codex conversations. The
post-fix Codex retest used a genuine dormant user conversation, created one new
Herdr execution and reopened the exact conversation. Internal Guardian sessions
are now excluded from discovery.

### 7. Check duplicate prevention

- [ ] Pass
- [x] Fail
- [ ] Blocked

- Refresh and repeat Resume: it must not create another execution.
- A provider session already exactly matched to a live Herdr execution must not
  offer Resume.
- If a plausible same-provider/workspace Herdr execution exists but its exact
  session ID is unknown, Observatory should say `Possibly running` and block
  ordinary Resume.

Notes: provider sessions and unidentified Herdr executions are both listed, but
without exact provider identity Observatory cannot prove that they represent
different work. Resume can therefore duplicate an already-running Herdr
session instead of reporting `Possibly running` and blocking.

Post-fix retest: [x] Pass / [ ] Fail

### 8. Restart only Observatory

- [x] Pass
- [ ] Fail
- [ ] Blocked

Leave Herdr running, restart Observatory against the same database, then check:

- the same Agents and Goals return;
- live executions reconnect;
- no Agent is duplicated or incorrectly marked stale; and
- Open terminal still works.

Notes: restarting Observatory against the same database worked without an
obvious duplicate, stale-state or reconnection problem.

### 9. Remove an execution, then resume it

- [x] Pass
- [ ] Fail
- [ ] Blocked

Stop one disposable Herdr execution and refresh Observatory. The same Agent
should become dormant/resumable rather than stale. Resume should attach one new
execution without changing its Agent or Goal.

Notes: verified against the active Codex conversation. Closing its Herdr
execution made the Agent resumable; exact resume rebound the same conversation
and this test thread continued successfully.

### 10. Reset the disposable Observatory database

- [x] Pass
- [ ] Fail
- [ ] Blocked

Stop Observatory, then run:

```sh
AO_DB_PATH=/private/tmp/ao-manual-continuity.sqlite bun run db:reset
```

Restart with the same database path. Provider conversations should return to
Session import. Old Observatory Goals and assignments should not be invented.
Live Herdr executions should appear once, and an exact live provider session
should bind without launching a duplicate when imported.

Notes: verified by deleting Observatory data and restarting. Provider sessions
were rediscovered, the live Codex conversation appeared once as exact-live and
could be imported into a newly created Goal without launching a duplicate.

### 11. Check a large Session import list

- [ ] Pass
- [x] Fail
- [ ] Blocked

Using the normal local provider history, open Session import and check whether
a specific provider session can be found and understood quickly using search,
provider/workspace/state filters, compact rows and bulk selection.

Notes: the existing local history produces a long stack of large cards in a
small panel. It needs a dedicated Session import surface with search, filters,
compact rows and bulk actions.

Post-fix retest: [ ] Pass / [ ] Fail

## Findings

### FIND-001 — Session import needs its own scalable surface

- Status: Implemented; awaiting manual retest
- Session import is a provider-conversation catalogue, not merely recovery.
- Mixing it with tracked Herdr-observed Agents in the small `Work awaiting a
home` panel is confusing and does not scale.
- Direction: a full-screen Session import view with search, filters, compact
  rows and bulk actions. Keep the unassigned-work panel small.

### FIND-002 — Repository details contradict each other

- Status: Implemented and manually verified
- The `synthetic-alerting` inspector resolves
  `example/synthetic-alerting` and branch `main` in Code status, but also shows
  Repository and Branch as `Unknown` below.

### FIND-003 — Show operational IDs in the inspector

- Status: Implemented and manually verified
- Show copyable Observatory Agent, provider session and current Herdr execution
  IDs. Do not expose transcripts, credentials or transcript-file paths.

### FIND-004 — Resume can duplicate an unidentified Herdr execution

- Status: Implemented and manually verified
- Claude Code Resume works, but Observatory may not know that an unidentified
  Herdr execution already owns the selected provider conversation.
- Direction: show `Possibly running` and block ordinary Resume whenever a
  plausible unidentified execution exists. Only exact evidence should bind
  automatically.

### FIND-005 — Track transition has no clear feedback

- Status: Implemented and manually verified for the Goal-first import path
- Track successfully converts a recovered provider conversation into a tracked
  unassigned Agent, but the card simply moves lower in the same panel.
- Direction: explicitly confirm `Session imported as an Agent`, distinguish the
  source and destination sections, and offer a clear next action such as View
  Agent or Assign to Goal. A future dedicated Session import view should make
  leaving the import catalogue visually unambiguous.

### FIND-006 — Shift+Enter is lost in the browser terminal

- Status: Implemented and manually verified
- xterm.js forwarded `Shift+Enter` as ordinary `Enter`, so Agent composers
  submitted instead of inserting a newline.
- Direction: encode unmodified `Shift+Enter` as CSI-u at the browser terminal
  boundary while leaving ordinary `Enter` and other keyboard input unchanged.
- First retest failed because xterm's follow-up `keypress` still emitted
  ordinary `Enter` after the mapped `keydown`. The complete modified-key event
  sequence is now consumed while CSI-u is emitted exactly once.

## Final result

- Passed:
- Failed:
- Blocked:
- Release blockers:
- Enhancements:
