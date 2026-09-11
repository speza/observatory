# Persistence review: `src/persistence/`, `src/repositories/`, `src/workspaces/`

Scope: `src/persistence/sqlite/sqlite-store.ts`, `src/persistence/sqlite/sqlite.test.ts`,
`src/repositories/`, and any persistence-facing code in `src/workspaces/`. Reviewed against
`AGENTS.md`, `docs/design/technical-architecture.md` and `docs/design/technology-decisions.md`.
Review only; no source files were modified.

Method: static review plus focused probes against the real store (default pragmas, FK delete
costs, concurrent-write behaviour, partial schema bootstrap, stale-revision transitions,
N+1 query volume). `bun test src/persistence/sqlite/sqlite.test.ts` passes (11/11).

Re-validated 2026-09-11 and resolved in the same change:

| Finding                                        | Outcome                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| H1 missing FK indexes                          | Fixed: indexes added                                                      |
| H2 non-atomic schema bootstrap                 | Fixed: DDL now runs in an immediate transaction                           |
| M1 busy timeout / rollback journal             | Fixed: `busy_timeout = 5000`; WAL not adopted                             |
| M2 stale transition revisions                  | Fixed: monotonic transition insert                                        |
| M3 unacknowledged transition retention         | Rejected: hard cap is explicit spec behaviour; see note                   |
| M4 N+1 alias queries                           | Fixed: single alias query per `conversations()`                           |
| M5 corrupt JSON poisons reads                  | Fixed: per-row graceful parsing on list reads                             |
| L1 silent launch-receipt no-op                 | Fixed: zero-row update now throws                                         |
| L2 silent enum coercion                        | Rejected: deliberate normalisation; see note                              |
| L3 reset counts outside transaction            | Fixed: counts computed inside the transaction                             |
| L4 snapshot key sentinel collision             | Rejected: single-column keys are all NOT NULL primary keys today          |
| L5 ordering indexes / statement re-preparation | Partially fixed: index added; re-preparation claim withdrawn (Bun caches) |

Ordered by severity.

---

## High

### H1. [Fixed] Missing child-key indexes make every FK-enforced row deletion scan entire child tables

References: `src/persistence/sqlite/sqlite-store.ts:1313` (goals FK), `:1328`–`:1366`
(agents FK), `:1375`–`:1382` (dismissal FKs), `:1471`–`:1473` (the only explicit indexes),
`:676`–`:703` (snapshot delete/insert path), `:339` (`PRAGMA foreign_keys = ON`).

The schema opens SQLite with foreign keys ON but creates no index on `goals.system_id`,
`agents.primary_goal_id`, or `related_agent_dismissals.agent_id`. SQLite must check child rows
for every parent row deleted; without an index each check is a full child-table scan. The
snapshot saver deletes omitted and changed rows on every `save()`
(`prepareSnapshotTable`'s `remove` at `:679`–`:681`, `:693`, `:698`), so any operation that
removes goals/systems/agents pays this cost. Measured on the real store: deleting 1,000
unreferenced goals with 50,000 agents took **1,956 ms** without the index and **42 ms** after
`CREATE INDEX probe_agents_goal ON agents(primary_goal_id)` (~46x). `DELETE FROM systems` scans
`goals` the same way; `DELETE FROM agents` scans `related_agent_dismissals`.

Why it matters: resets, snapshot omissions, and any future bulk-archive/cleanup become
quadratic (`parents × children`) and can stall the single synchronous control-plane thread that
serves host reconciliation and HTTP. This grows exactly where the design already accumulates
data (agents and history).

Fix: add the missing indexes in `initializeSchema` (additive `CREATE INDEX IF NOT EXISTS` is
data-compatible; if the strict clean-break policy is applied, bump
`SQLITE_SCHEMA_GENERATION` at `:188` and accept the documented reset):

```sql
CREATE INDEX IF NOT EXISTS agents_primary_goal ON agents(primary_goal_id);
CREATE INDEX IF NOT EXISTS goals_system ON goals(system_id);
CREATE INDEX IF NOT EXISTS related_agent_dismissals_agent ON related_agent_dismissals(agent_id);
```

Add a regression test asserting these appear in `PRAGMA index_list(...)`, and consider a
mutation-count or `EXPLAIN QUERY PLAN` assertion rather than timing.

Resolution: added `agents_primary_goal` (partial), `goals_system` (partial),
`related_agent_dismissals_agent`, and `launch_receipts_updated` to `initializeSchema`
(`src/persistence/sqlite/sqlite-store.ts:1533`–`:1543`). The change is additive and compatible,
so no `SQLITE_SCHEMA_GENERATION` bump is required; existing generation-3 databases receive the
indexes on next startup. Covered by the index test in `sqlite.test.ts`.

### H2. [Fixed] Schema bootstrap is not atomic and can permanently brick a fresh database

References: `src/persistence/sqlite/sqlite-store.ts:1291`–`:1304` (generation guard),
`:1305`–`:1475` (one `db.exec` containing ~20 DDL statements plus `PRAGMA user_version`),
`:1474` (`PRAGMA user_version = ${SQLITE_SCHEMA_GENERATION}`).

`initializeSchema` runs all DDL in a single `db.exec` with no surrounding transaction. SQLite
autocommits each DDL statement when not inside a transaction, so a crash, `SQLITE_FULL`, or any
statement error part-way through leaves a partially created schema with `user_version = 0`.
The next startup sees `existingTableCount > 0 && generation !== SQLITE_SCHEMA_GENERATION` and
throws "This Observatory database uses an incompatible schema. Reset it before starting
Observatory." even though no user data exists. Verified: a database containing only a `systems`
table triggers exactly that error. Importantly, the version stamp is the last statement, so it
never lands on failure, and there is no path that repairs a partial bootstrap.

Why it matters: a crash during first-run setup (or a failed upgrade once generations advance)
turns a recoverable initialization into a manual reset instruction, with no diagnostic of what
actually happened. The architecture explicitly wants explicit compatibility, but this is
indistinguishable from a genuinely incompatible database.

Fix: wrap the entire DDL block plus the version stamp in one immediate transaction, e.g.
`this.db.transaction(() => { this.db.exec(...); })().immediate()` (or `BEGIN IMMEDIATE`/`COMMIT`
around the `exec`), so the schema and `user_version` land or roll back together. Optionally
treat `user_version = 0` with a subset of current tables as "incomplete bootstrap" and retry
creation once, then still fail closed for genuinely mismatched generations. Add a test that
simulates a failing DDL statement and asserts the database is either fully current or empty
(no partial state with `user_version = 0`).

Resolution: `initializeSchema` now runs the whole DDL block inside `this.db.transaction(...)`
with `.immediate()` (`src/persistence/sqlite/sqlite-store.ts:1363`–`:1546`). The new
"rolls back a failed schema bootstrap" test forces a mid-DDL name conflict and asserts that no
schema tables were created.

---

## Medium

### M1. [Fixed] No `busy_timeout` and rollback-journal mode: concurrent access fails immediately

References: `src/persistence/sqlite/sqlite-store.ts:336`–`:341` (constructor sets only
`PRAGMA foreign_keys = ON`).

Probed defaults on Bun's `bun:sqlite`: `journal_mode = delete`, `synchronous = 2`,
`busy_timeout = 0`, `foreign_keys = 0` (set to 1 by the store). With `busy_timeout = 0`, a
`BEGIN IMMEDIATE` (`write.immediate()` at `:635`) returns `SQLITE_BUSY` immediately rather than
waiting. Verified: with connection A holding `BEGIN IMMEDIATE`, `storeB.save(...)` failed with
`database is locked`. Tests already open two connections (`sqlite.test.ts:199`), `backupTo`
(`:1141`) and `scripts/reset-database.ts` are separate processes, and any second Observatory
process or dev tool overlaps the same file. In rollback-journal mode a long read can also block
the writer.

Why it matters: the design assumes a single local process, but nothing enforces it and the
failure mode is an unhandled exception on a save path that Universe reports as "rolled back",
silently dropping a command under momentary contention. WAL would additionally make the
read-heavy projection path independent of writes.

Fix: set `PRAGMA busy_timeout = 5000` (or a configured value) right after opening the database,
before `initializeSchema`. Consider `PRAGMA journal_mode = WAL` plus `synchronous = NORMAL`
for the single-process durability/concurrency trade-off (note WAL changes the on-disk file
set), and document the choice. Add a contention test that holds a write transaction on one
connection and asserts a second save waits and then succeeds once released.

Resolution: `PRAGMA busy_timeout = 5000` is set in the constructor
(`src/persistence/sqlite/sqlite-store.ts:341`) and asserted in the new index/pragma test. WAL
was not adopted: Observatory is documented as one local single-process owner per database, and
WAL changes the on-disk artifact set; the timeout addresses the realistic second-connection
case without that change. A deterministic contention test is impractical with synchronous
`bun:sqlite` on one thread, so the pragma assertion is the regression guard.

### M2. [Fixed] Observation transitions accept stale revisions while current rows reject them

References: `src/persistence/sqlite/sqlite-store.ts:901`–`:910` (current upsert guarded by
`excluded.revision >= agent_observation_current.revision`), `:932`–`:947` (transitions use
`INSERT OR IGNORE` on `UNIQUE(harness_id, observation_id, revision)` only),
`src/agent-observations/projection.ts:478`–`:489` (transitions sorted by arrival `sequence`
descending; `newest = items[0]`).

A late event for the same observation at a lower revision is stored as a new transition row
with a higher arrival sequence. Verified against the real store: after accepting revision 2
then a late revision 1, transitions were `[{seq:1, rev:2}, {seq:2, rev:1}]` while current
correctly stayed at revision 2. Catch-up sorts by `sequence`, so the stale revision is
presented as the newest evidence, and `changedObservations` also reports it as a change.
`coordinator.test.ts:771` only covers replaying the same revision, not a lower one.

Why it matters: provider hook delivery is best-effort and retained-event snapshots can arrive
out of order; the persistence guard that protects current state does not protect the evidence
stream, contradicting "out-of-order observations are ignored without regressing accepted
state" (`technical-architecture.md:394`).

Fix: make the transition insert monotonic per observation:

```sql
INSERT INTO agent_observation_transitions (...)
SELECT ?, ?, ?, ?, ?
WHERE NOT EXISTS (
  SELECT 1 FROM agent_observation_transitions
  WHERE harness_id = ? AND observation_id = ? AND revision >= ?
);
```

and add a store/coordinator test for a late lower-revision transition.

Resolution: the transition insert now uses `INSERT ... SELECT ... WHERE NOT EXISTS (... revision

> = ?)` (`src/persistence/sqlite/sqlite-store.ts:948`–`:956`), so lower revisions are discarded
> while equal and higher revisions keep the existing dedupe semantics. The new "stale transition
> revisions are not retained as newer evidence" test covers the exact case and asserts the change
> set is empty.

### M3. [Rejected] Transition retention silently drops unacknowledged evidence

References: `src/persistence/sqlite/sqlite-store.ts:948`–`:953` (global trim to the newest
5,000 transitions on every reconcile), `:1049`–`:1080` (`agent_observation_checkpoint` only
advances on explicit acknowledgement), `src/agent-observations/projection.ts:536`–`:538`
(pending/evidence counts come from retained transitions).

Retention ignores the checkpoint. If more than 5,000 transitions accumulate before the
operator acknowledges, the oldest rows are deleted even though they were never displayed.
Catch-up then cannot ever show them, and `acknowledgeAgentObservations` boundaries still
validate against the surviving maximum. The 500-row current-claim bound (`:919`–`:931`) is
per harness and does not have this problem.

Why it matters: silent evidence loss before the durable operator acknowledgement point, which
is the mechanism the design uses to promise the operator can catch up on everything
(`technical-architecture.md:426`–`:453`). Hooks are explicitly best-effort, but once accepted
into SQLite they should be either acknowledged or explicitly truncated.

Fix: trim only the acknowledged prefix (`sequence <= operator checkpoint`) and keep a separate
hard safety valve for the unacknowledged window that is surfaced as a diagnostic/truncated
flag in the evidence projection rather than silently deleting. If the current bound is the
intended product behaviour, document it in the design section and return a truncation signal
from `reconcileAgentObservations`.

Validation outcome (rejected as a defect): the feature spec explicitly requires this hard cap:
"catch-up transitions are deleted after acknowledgement and the unacknowledged tail has a hard
cap" (`docs/specs/provider-native-agent-observations.md:660`–`:661`). Dropping the oldest
unacknowledged tail on overflow is intended bounded-memory behaviour, not a correctness bug.
One residual design question is worth tracking separately: the cap is global across sources
rather than per harness, so a chatty source can evict another source's unacknowledged tail.
That is a product/retention decision, not a persistence defect, and no code change was made
here.

### M4. [Fixed] N+1 alias queries in `conversations()` run on every host reconciliation

References: `src/persistence/sqlite/sqlite-store.ts:819`–`:826` (`conversations()`),
`:1108`–`:1114` (`conversationFromRow` issues one alias query per row),
`src/conversations/tracker.ts:146`–`:148` (calls `store.conversations()` on every host
observation), `src/web/main.ts:361`–`:365` (host refresh loop).

`conversations()` loads N conversation rows and then runs N alias queries, each prepared on
demand (`db.query`). The host refresh loop calls this on every poll through
`ConversationTracker.observeHost`, independent of whether the provider catalogue changed.
Measured on the real store: 5,000 conversations produced 5,001 statements and ~11 ms per call;
cost scales linearly with the retained catalogue (the catalogue is only pruned on `complete`
snapshots, `:728`–`:731`).

Why it matters: repeated per-poll work in the synchronous path that also services HTTP and
reconciliation; it grows with every retained provider conversation, and the same data is
re-read for `snapshotRequest()` and `history()`.

Fix: fetch aliases once for the whole page with a single
`SELECT * FROM provider_conversation_aliases WHERE handle IN (?, ...)` (or a join/aggregate),
group in memory, and reuse prepared statements. `conversation(handle)` can share the same
helper. Add a statement-count or query-count regression test.

Resolution: `conversations()` now reads every alias in one ordered query and groups them by
handle (`src/persistence/sqlite/sqlite-store.ts:821`–`:840`), with `conversation(handle)`
keeping its single-record path. The new "loads conversation aliases without a per-conversation
query" test wraps `db.query` and asserts exactly one alias query for three conversations.

### M5. [Fixed] A single corrupt JSON row poisons whole reads and can block startup paths

References: `src/persistence/sqlite/sqlite-store.ts:1082`–`:1097`
(`observationSourceFromRow`), `:1099`–`:1106` (`observationFromRow`), `:1232`–`:1241`
(`loadLaunchReceipt` throws on decode), `:1244`–`:1254` (`launchReceipts()` fails the whole
listing on one bad row), `:1020`–`:1036` (`currentAgentObservations`/transitions).

`executionBindings` at `:270`–`:277` already degrades to `[]` on malformed JSON, but the
observation, source and launch-receipt readers throw. One malformed value (manual edit, partial
external write, future schema drift, disk corruption) therefore breaks provider-evidence
reconciliation/projection and pending-launch listing rather than isolating the row.

Why it matters: a local SQLite file is still subject to partial corruption, and the store is
the only recovery path. Failing the entire stream converts one bad row into a non-starting or
non-reconciling control plane. The design's uncertainty stance also favours explicit degraded
evidence over an exception.

Fix: decode per row (`Schema.decodeUnknownEither`, guarded `JSON.parse`) and collect typed
diagnostics, skipping/quarantining only the bad row; expose the count so projections can mark
evidence degraded. Keep `foreign_key_check` and schema validation strict.

Resolution: `observationSourceFromRow` and `observationFromRow` now return `undefined` for
malformed JSON (`src/persistence/sqlite/sqlite-store.ts:1113`–`:1148`) and the list readers
(`observationSource`, `agentObservationSources`, `currentAgentObservations`,
`agentObservationTransitions`) skip those rows; `launchReceipts()` skips receipts that fail
decoding while single-record `loadLaunchReceipt` stays strict. The new "skips corrupt evidence
and receipt rows" test seeds malformed values in all four tables and asserts clean reads.

---

## Low

### L1. [Fixed] `saveLaunchReceipt` silently no-ops when no row matches

References: `src/persistence/sqlite/sqlite-store.ts:1276`–`:1288`.

The `UPDATE ... WHERE request_id = ? AND intent_fingerprint = ?` result is discarded. If the
receipt was cleared (reset) or the fingerprint drifted, the launch outcome is silently lost
while the caller believes it persisted; `reserveLaunchReceipt` (`:1256`–`:1274`) carefully
checks `changes`, but `saveLaunchReceipt` does not. Fix: assert `result.changes === 1` and
surface a typed error so `StartAgentCoordinator.remember` (`src/session-launch/coordinator.ts:
495`–`:513`) fails loudly; add a test for the zero-row case.

Resolution: `saveLaunchReceipt` now throws when `changes !== 1`
(`src/persistence/sqlite/sqlite-store.ts:1331`–`:1345`), with a regression test asserting the
zero-row case.

### L2. [Rejected] Invalid enum values are silently coerced into accepted state on load

References: `src/persistence/sqlite/sqlite-store.ts:243`–`:287` (`asPriority`, `asGoalStatus`,
`asRuntimeState`, etc.).

Unknown strings become `P2`/`active`/`unknown`/`stale` with no diagnostic. An unexpected value
written by a future bug or external tool becomes plausible accepted semantic state (a corrupted
goal silently becomes `P2 active`), which cuts against "preserve uncertainty". Fix: add `CHECK`
constraints (or a write-side enum guard) so invalid values cannot be stored, and surface a
diagnostic identifying the row when a read-time coercion still occurs.

Validation outcome (rejected for this change): the clean-break policy means adding `CHECK`
constraints requires bumping `SQLITE_SCHEMA_GENERATION` and resetting existing databases, which
is disproportionate for a low-severity hardening item. Failing fast on read would also conflict
with the per-row resilience fix in M5. Normalisation here is deliberate; revisit if a
migration path or write-side validator lands.

### L3. [Fixed] Reset counts are read outside the reset transaction

References: `src/persistence/sqlite/sqlite-store.ts:1145`–`:1181`,
`:1183`–`:1209`, `:1211`–`:1223`.

`resetCounts()` runs before the delete transaction, so a concurrent writer could make the
returned summary inconsistent with what was deleted (single-process risk is low). Fix: compute
the counts inside the same transaction and return them from it.

Resolution: both reset methods now compute counts inside the transactional callback and return
them from it (`src/persistence/sqlite/sqlite-store.ts:1194`–`:1259`).

### L4. [Rejected] Snapshot key sentinel can collide with a literal `"null"` string key

Reference: `src/persistence/sqlite/sqlite-store.ts:661`–`:664`.

For single-column keys, `row[keyIndexes[0]] ?? "null"` maps null to the string `"null"`; a
string primary key with the literal value `"null"` would collide with a null key. Current keys
are non-null, so this is theoretical; fix by encoding all keys as `JSON.stringify([...])` (as
the multi-key branch already does) so types cannot alias.

Validation outcome (rejected as not reachable): every single-column key used by
`prepareSnapshotTable` is a NOT NULL primary key (`id`, `host_instance_id`, `sequence`,
`singleton`), so the null branch cannot produce a colliding key today. No change made.

### L5. [Partially fixed] Ordering queries lack supporting indexes and statements are re-prepared per call

References: `src/persistence/sqlite/sqlite-store.ts:819`–`:825` (order by
`COALESCE(last_active_at, created_at, observed_at)`), `:1244`–`:1248` (order by `updated_at`
with no index), `:647`–`:653` (`storageRevision` prepares two queries per save).

Both orderings are full sorts today (small tables, so not urgent), and hot reads re-prepare
statements on every call. Consider `CREATE INDEX ... ON launch_receipts(updated_at)` and
hoisting prepared statements for `storageRevision`/`conversations`. Revisit if catalogues or
receipts grow.

Validation outcome: added `launch_receipts_updated` in H1. The statement re-preparation claim
was withdrawn: `bun:sqlite`'s `db.query(sql)` returns the same cached prepared statement for
the same SQL string (verified by object identity), so repeated calls do not re-parse.

---

## Test coverage assessment

Strong coverage already exists for the hard parts: snapshot atomicity with a late failure and
rollback (`sqlite.test.ts:85`–`:175`, `:537`–`:555`), identity-swap delete-before-insert
(`:119`–`:145`), bookkeeping across outer rollback/reset/other-connection writes (`:177`–`:211`),
restart round-trips including checkpoints and provider/execution lifetimes (`:213`–`:348`,
`:442`–`:521`), history-prefix protection with triggers (`:56`–`:67`), and the clean-break
generation guard (`:350`–`:440`). Current-claim bounding and equal-revision replay are covered
in `agent-observations/coordinator.test.ts:771`/`:830`.

Gaps worth adding:

- contention/`busy_timeout` behaviour (two connections, held write lock);
- partial-schema bootstrap (H2) and `backupTo`/`VACUUM INTO` failure modes (target exists,
  busy source);
- transition retention beyond the 5,000 bound relative to the checkpoint (M3);
- late lower-revision transition (M2);
- corrupt JSON rows in each reader (M5);
- launch-receipt conflict and zero-row update (L1);
- index presence/query-plan regression for H1;
- statement-count regression for `conversations()` (M4);
- pragma assertions (`foreign_keys`, `busy_timeout`) so connection setup cannot regress.

Added in the resolution change (`sqlite.test.ts`, 17 tests total now):

- index presence plus `busy_timeout` assertion (H1, M1);
- failed-bootstrap rollback via a mid-DDL name conflict (H2);
- late lower-revision transition (M2);
- single alias query for `conversations()` (M4);
- corrupt evidence and receipt rows skipped on list reads (M5);
- zero-row `saveLaunchReceipt` rejection (L1).

Still open (deliberately deferred): contention timing, `backupTo` failure modes, transition
retention boundary tests, and non-silent retention diagnostics (M3 tracking item).

## `src/repositories/` and `src/workspaces/` notes

- `src/repositories/` contains no SQLite or file persistence; status is derived from Git,
  plugins, and Universe metadata. The pull-request cache
  (`src/repositories/reader.ts:122`, `:272`–`:284`) is an unbounded in-memory `Map` keyed by
  provider/repo/branch/head. Each new head leaves an entry forever; a long-lived server on an
  active branch accumulates them. Consider a small LRU/size cap. No persistence contract is
  violated.
- `src/workspaces/` has no persistence-facing code. Review snapshots are deliberately
  process-local capabilities with a TTL and cap (`src/workspaces/local.ts:34`–`:35`, `:618`,
  `:894`–`:900`, `:1039`–`:1048`) and expiry is tested (`local.test.ts:310`), which matches the
  architecture rule that review content is ephemeral and only semantic state is durable.

## Verified sound

- All user data is bound through SQL parameters; the only interpolated SQL identifiers are
  module constants from fixed call sites (`prepareSnapshotTable` `:655`–`:704`,
  `initializeSchema` `:1305`–`:1475`). No injection surface found.
- `save()` is one immediate transaction with deferred FK enforcement and an explicit
  `foreign_key_check` before commit (`:500`–`:645`), and the cache is published only after a
  successful commit, with correct handling of caller-owned outer transactions (`:636`–`:644`).
- Cache invalidation via `total_changes()` + `PRAGMA data_version` correctly detects same- and
  other-connection writes, failed writes and resets (`:647`–`:653`, `:501`, tests `:39`–`:83`,
  `:177`–`:211`).
- All seven semantic tables round-trip explicit edits, omissions and cleared optional values,
  and unchanged snapshots perform zero mutations (`:39`–`:175`).
- Provider catalogue and observation writes validate declared scope before writing and run in
  transactions (`:710`–`:817`, `:855`–`:981`), so a scope escape cannot partially apply.
