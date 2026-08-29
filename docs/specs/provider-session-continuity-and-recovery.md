# Provider-session continuity and execution recovery

Status: Phase 2 implemented; Phase 3 launch acknowledgement remains

Date: 2026-08-28

Depends on:

- [Agent harness plugins](agent-harness-plugins.md)
- [Agent launch and workspace preparation](session-launch.md)
- [Agent and linked execution model](agent-execution-model.md)
- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Observatory technical architecture](../design/technical-architecture.md)

## Why

Observatory currently discovers live agent executions primarily through Herdr.
That makes a host pane do two jobs: identify the durable work and locate its
current process. The two responsibilities diverge as soon as Herdr, the machine
or Observatory restarts.

A Claude Code, Codex or Pi conversation can remain resumable after its terminal
and process disappear. Conversely, a Herdr pane can remain alive while the
provider conversation inside it changes. Remote execution strengthens the same
distinction: a conversation may be durable on a remote VM without being
portable to the operator's laptop.

The product must answer these questions independently:

1. What supervised work does this represent?
2. Which provider-owned conversation carries its execution continuity?
3. Where, if anywhere, is that conversation running now?
4. Where can it truthfully be resumed?

## Decision

The durable product object remains the Observatory **Agent**. For supported
harnesses, a provider-owned session is its primary continuity anchor. A
`SessionHost` supplies a replaceable execution binding and terminal capability;
it does not define Agent continuity.

```text
Goal
  └── Observatory Agent
        ├── provider session       Claude / Codex / Pi conversation
        ├── workspace context      site-scoped files and repository state
        └── execution binding?     current Herdr / tmux / native process
```

The three authorities are deliberately different:

| Concern                                                            | Authority              |
| ------------------------------------------------------------------ | ---------------------- |
| Goal, assignment, human name, lifecycle and accepted relationships | `Universe`             |
| Conversation identity and exact resume semantics                   | agent harness/provider |
| Current process, PTY, terminal and attachment                      | `SessionHost` instance |

A provider session is a durable continuity record, not an inherently portable
object. Resume is offered only on destinations whose access to that session,
workspace and credentials is proven.

This decision supersedes the host-first discovery portions of the current
harness design. Host correlation such as `(hostInstanceId, nativeId)` identifies
an execution, not the durable Agent.

## Success criteria

The design succeeds when:

- restarting a laptop can turn a previously running Agent into
  `dormant/resumable` without changing its Goal or Agent identity;
- deleting Observatory's database can rediscover provider sessions as
  unassigned recovery candidates without inventing lost Goals or assignments;
- restarting Herdr cannot by itself make a provider conversation stale or
  create a replacement Agent;
- a new Herdr execution can exactly resume a dormant session on a proven
  eligible site;
- local and remote Herdr instances use the same contracts and cannot collide;
- a remote session is never presented as locally resumable without explicit
  provider portability evidence;
- missing hooks, transport loss and incomplete catalogues preserve uncertainty;
  and
- no launch retry creates a second process while the original outcome is
  ambiguous.

## Identity model

### Observatory Agent

`AgentId` remains Observatory-owned and stable across execution replacement.
The Agent owns semantic history, Goal assignment, human naming, archive state,
attention and accepted relationships.

For V1, an accepted managed Agent has at most one current primary provider
session and at most one accepted interactive execution binding. Conflicting
executions are retained as observations and surfaced for resolution; they are
not silently collapsed.

An explicit provider-proven succession, such as an in-place conversation reset,
may replace the Agent's current provider session while retaining the previous
reference as history. Without that proof, a new provider session is a new Agent
candidate rather than an automatic continuation.

### Provider session

A provider session reference is scoped to the provider installation, account or
storage domain that owns its continuity:

```text
ProviderSessionRef
  harnessId             "claude-code" | "codex" | "pi" | ...
  continuityScopeId     opaque configured account/storage scope
  nativeConversationRef opaque provider-owned identifier
```

`continuityScopeId` prevents a UUID observed on one machine from implying that
another machine can access it. A provider adapter may later prove that several
sites share one account-global continuity scope; Observatory does not infer
that from provider name, credentials, paths or matching UUID text.

Provider references are sensitive operational metadata. Projections use an
Observatory-issued handle and bounded display facts rather than exposing the
native value to the browser.

### Session home and resume eligibility

Every discovered session records the evidence for where it can continue:

```text
SessionContinuity
  homeSiteRef?
  workspaceRef?
  capabilities
    same-host-resume?
    same-site-resume?
    provider-account-resume?
    export-import?
  eligibleDestinations[]
  observedAt
  provenance
```

Capabilities are observations, not promises invented by Observatory. The
absence of portability evidence means same-site resume only, or `unknown` when
even that cannot be proved.

### Execution binding

An execution binding is replaceable operational state:

```text
ExecutionBinding
  agentId
  hostInstanceId
  nativeExecutionId
  environmentRef?
  workspaceRef?
  providerSessionHandle?
  observedAt
  evidence
```

The host-native ID remains opaque. A fresh complete snapshot from one host
instance can update or remove only that instance's binding. It cannot stale a
session or execution belonging to another host instance.

### Host-only compatibility

An execution without a provider session is an **unidentified execution**. It
can retain terminal access and bounded host metadata, but it must not silently
inherit a Goal or claim durable resume.

A human may explicitly track it as a degraded host-bound Agent when no harness
can expose provider identity. That compatibility path states its limitation:
continuity lasts only as long as the host can prove the execution.

## Provider-session catalogue

Each configured agent-provider instance exposes a site-local catalogue when the
provider makes durable sessions discoverable. The catalogue reports metadata,
not complete conversation contents:

```text
ProviderSessionObservation
  ref
  providerInstanceId
  homeSiteRef?
  createdAt?
  lastActiveAt?
  title?
  workspaceRef?
  resumeCapabilities
  provenance
```

Initial discovery must not require transcript ingestion. An adapter may read a
provider index, file header, structured list command, SDK or provider endpoint.
Reading messages, prompts or tool output is a separate optional capability and
requires an explicit product decision.

A catalogue snapshot declares its scope, completeness and retention window.
Absence from a partial, paginated or age-bounded snapshot does not prove that a
session was deleted. A complete snapshot is authoritative only for its declared
provider instance and scope.

Catalogue observations create operational **Session import** candidates. They do not put
every historical conversation into the Atlas. A session becomes an accepted
Agent when a human tracks, assigns or resumes it, or when a durable launch
operation proves that Observatory created it for an accepted intent.

Provider catalogues must expose only conversations the provider considers
user-resumable. Internal review, compaction, helper and subagent sessions are
provider implementation details, not import candidates. For Codex, a
non-user `thread_source` or structured subagent source is excluded even when it
has an ID, workspace and index title. Observatory must not work around that by
passing an include-non-interactive flag to the CLI.

## Harness module

The existing `AgentHarness` module should deepen rather than gain a second
provider-facts pass-through seam. Its small interface must hide hooks, file
formats, structured process protocols and provider version differences.

The target responsibilities are:

```text
AgentHarness
  describe and report availability
  snapshot provider sessions for one configured provider instance
  prepare a genuinely new-session process plan
  prepare an exact-resume process plan
  assess eligible resume destinations
  correlate provider identity observations with host executions
```

Not every harness supports every responsibility. Capability reporting is
explicit:

- **managed:** start, exact resume and durable catalogue;
- **launch-only:** start can be identified, but historical catalogue discovery
  is unavailable;
- **observe-only:** sessions can be discovered but Observatory cannot start or
  resume them;
- **host-only:** no provider identity mechanism is available.

Claude Code, Codex and Pi should target `managed`. A provider without a durable
catalogue can still run, but database-wipe recovery cannot be promised.

## Identity acquisition

Provider identity must come from a provider-owned acknowledgement, never from a
working-directory or newest-file guess.

Supported mechanisms include:

- a structured start response, such as a Codex `thread/start` response;
- an initial structured event, such as `thread.started`;
- an SDK object exposing its session ID, such as Pi;
- a lifecycle hook carrying the provider-generated ID, such as Claude Code;
- a provider session-list operation that accepts an exact launch correlation;
  or
- a native host integration that reports the exact provider reference.

For asynchronous CLIs, Observatory supplies an opaque launch correlation token:

```text
AO_LAUNCH_ID=<durable launch-operation id>
```

The site-local identity reporter combines that token with the provider-owned
session ID. It does not send prompts, transcript content, credentials or raw
terminal output.

Hooks are an observation source, not the system of record and not the remote
transport. A missed hook leaves the operation pending until a later recurring
event or catalogue snapshot repairs it. Selecting the newest session by mtime,
cwd, process name or title is never sufficient continuity proof.

## Local and remote execution

Herdr is the preferred first `SessionHost` wherever Observatory controls a
persistent machine. Local and remote Herdr use the same host interface:

```text
Observatory control plane
  ├── local site
  │     ├── provider catalogue adapters
  │     ├── Git workspace provider
  │     └── Herdr SessionHost
  └── remote VM site
        ├── provider catalogue adapters
        ├── Git workspace provider
        └── Herdr SessionHost
```

Provider catalogue and workspace operations run where their state lives. An
outbound node connector or an initial SSH adapter transports serializable
capabilities; Observatory must not expose or tunnel Herdr's raw Unix socket.

A site-local hook writes to a bounded durable outbox or sends through the
connector. On reconnect, the connector first supplies fresh provider and host
snapshots, then replays deduplicated events. Events improve latency but do not
replace reconciliation.

Remote Herdr is a delivery choice, not the semantic architecture. Native E2B,
Modal or hosted-agent adapters remain possible when a persistent Herdr process
does not fit the environment lifecycle.

### Amendment to the distributed-execution proposal

This specification retains the distributed study's core decisions:

- one authoritative Observatory control plane;
- stable site, host, environment and workspace instance identity;
- site-local paths and capabilities;
- outbound connector or SSH transport rather than a public Herdr socket;
- durable idempotent launch operations; and
- disconnect and missing evidence preserving uncertainty.

It changes four host-first assumptions in that study:

1. `(hostInstanceId, nativeId)` identifies an execution, not an Agent.
2. Provider-session identity is the normal continuity anchor for a managed
   Agent, not optional enrichment.
3. Provider catalogue discovery exists independently from host execution
   discovery.
4. A managed Agent is accepted after provider identity is known; a host
   observation alone remains an unidentified or explicitly host-bound path.

The node connector therefore transports agent-harness catalogue and identity
capabilities alongside `SessionHost` and `WorkspaceProvider`. It remains a
capability edge, not a second semantic control plane.

## New-session flow

```text
User        Coordinator       Harness       SessionHost       Provider
 |               |               |               |               |
 | start intent  |               |               |               |
 |-------------->| persist op    |               |               |
 |               | planStart     |               |               |
 |               |-------------->| process plan  |               |
 |               |<--------------| + launch id   |               |
 |               | launchExecution               |               |
 |               |------------------------------>| start CLI     |
 |               |                               |-------------->|
 |               | provider-generated identity observation       |
 |               |<----------------------------------------------|
 |               | bind Agent + execution; assign Goal           |
```

The required ordering is:

1. Persist the idempotent launch intent before external side effects.
2. Resolve an explicit provider instance, site, workspace and host destination.
3. Ask the harness for a genuinely new-session plan.
4. Launch through `SessionHost` with the Observatory launch correlation.
5. Wait for strong provider identity evidence or return `pending identity`.
6. Reconcile the provider session and execution binding.
7. Accept and assign the Agent only when the managed session identity is known.

Host launch success alone does not manufacture a managed Agent. A timeout is an
ambiguous operation, not permission to retry blindly. Reconciliation must look
for the launch token and exact provider identity before another process starts.

## Resume flow

Resume is an explicit human action unless an accepted automatic policy says
otherwise:

1. Load the exact provider session and its latest continuity observation.
2. List only destinations proven eligible for that session and workspace.
3. Snapshot the target host and refuse when the same conversation is already
   live or the host state is unavailable.
4. Ask the harness for an exact-resume plan; never fall back to `latest` or a
   fresh conversation.
5. Launch through the selected host.
6. Require the provider acknowledgement to contain the same session identity.
7. Replace the Agent's execution binding; preserve its semantic history.

If a user wants to continue on an ineligible machine, Observatory may later
offer **Handoff to new session**. Handoff creates a new provider session and a
successor relationship. It does not pretend that the original session moved.

## Discovery and database reconstruction

Discovery has two independent inventories:

```text
provider catalogue                    host snapshot
durable/dormant conversations          current executions
          |                                  |
          +---------- exact evidence --------+
                             |
                     accepted binding or
                     recovery proposal
```

After a full Observatory database deletion:

1. reconnect configured or reaccepted provider instances and host instances;
2. scan provider catalogues;
3. show recent/relevant sessions in **Session import**;
4. scan Herdr or other hosts for current executions;
5. join only exact provider/launch/native integration evidence;
6. keep unmatched executions explicitly unidentified; and
7. let the operator choose a Goal and import or resume provider sessions into
   that Goal.

Goal assignment is the primary Session import path. After a single successful
import, Observatory closes the catalogue and focuses the new Agent on its Goal
in the Atlas so the destination is visible. `Import unassigned` remains an
explicit secondary action for genuinely untriaged work and states that the
Agent will appear in Inbox. It must not be the visually dominant default.

A database wipe cannot reconstruct Observatory-owned Goals, assignments,
human names, accepted relationships or layout. Those require an Observatory
backup/export. Provider discovery recovers conversations, not semantic intent.

Remote sessions can be rediscovered only after their provider site reconnects
or is reconfigured. Database deletion is not permission to probe arbitrary
machines or credentials.

## State model

Do not collapse provider presence, execution presence and observation health
into one `status` field.

```text
Provider continuity: confirmed | missing | unknown
Execution presence:  live | absent | unknown
Resume capability:   eligible | blocked | unsupported | unknown
Observation health:  fresh | stale | unavailable
```

The UI derives operator-facing states:

| Derived state          | Required evidence                                                                          | Meaning                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Running                | provider session confirmed; exact live execution                                           | Conversation is executing now                           |
| Dormant                | provider session confirmed; execution confirmed absent                                     | Conversation exists without a process                   |
| Resumable              | dormant plus at least one eligible destination                                             | Exact resume can be offered                             |
| Possibly running       | provider session confirmed; plausible unidentified execution in the same harness/workspace | Track is safe; resume is blocked pending exact evidence |
| Unavailable            | owning site or provider cannot be inspected                                                | Current execution state is not known                    |
| Unidentified execution | live host execution without provider proof                                                 | Terminal may work; continuity is unproved               |
| Continuity lost        | accepted Agent remains; provider session confirmed missing                                 | Semantic history remains, exact resume does not         |
| Stale observation      | evidence exceeded its freshness policy                                                     | No stronger lifecycle claim is justified                |

`stale` describes evidence age. It must not be used as a synonym for dormant,
stopped, deleted or failed.

## Recovery scenarios

| Scenario                                                | Provider session              | Execution                   | Required result                              | Available action                              |
| ------------------------------------------------------- | ----------------------------- | --------------------------- | -------------------------------------------- | --------------------------------------------- |
| Observatory process restarts                            | confirmed                     | still live                  | Reconcile the same binding                   | Open terminal                                 |
| Herdr restarts and loses panes                          | confirmed                     | confirmed absent            | Dormant/resumable                            | Resume exactly                                |
| Laptop restarts                                         | survives on disk              | old process absent          | Dormant/resumable on that laptop             | Start a new Herdr execution with exact resume |
| Observatory database is deleted                         | discoverable                  | live or absent              | Recovered, unassigned candidate              | Track, assign or resume                       |
| Remote transport disconnects                            | unknown                       | unknown                     | Unavailable, never dormant                   | Retry observation                             |
| Remote host reconnects without process                  | confirmed                     | confirmed absent            | Dormant/resumable on eligible remote site    | Resume remotely                               |
| Remote VM is replaced with persistent volume            | confirmed on restored storage | absent                      | Resume only after the new site proves access | Resume on proven destination                  |
| Ephemeral sandbox is destroyed                          | missing unless exported       | absent                      | Continuity lost or unknown                   | Inspect artifacts or hand off                 |
| Provider session is manually deleted                    | confirmed missing             | absent                      | Continuity lost                              | Preserve Agent history                        |
| Workspace is missing                                    | confirmed                     | absent                      | Dormant but resume blocked                   | Restore workspace or hand off                 |
| Existing external provider session is found             | confirmed                     | absent or exact live match  | Unassigned recovery candidate                | Track or resume                               |
| Existing session has a plausible unidentified execution | confirmed                     | unknown                     | Possibly running; do not infer identity      | Track only; block ordinary resume             |
| Herdr process has no provider identity                  | unknown                       | live                        | Unidentified execution                       | Inspect or explicitly track as host-bound     |
| Same provider session appears live twice                | confirmed                     | conflicting live executions | Conflict; do not choose automatically        | Human resolution                              |

### Laptop restart walkthrough

```text
Before restart
  Agent A -> Claude session C -> Herdr execution H1

After reboot and fresh snapshots
  Agent A -> Claude session C -> no execution
  derived state: dormant/resumable on this laptop

After explicit Resume
  Agent A -> Claude session C -> new Herdr execution H2
```

The old Herdr native ID is retained only as history. It is not reused as the
identity of the new execution.

## Reconciliation rules

1. Provider identity can preserve an Agent across execution replacement only
   when the scoped reference matches exactly.
2. A matching provider UUID in a different continuity scope is not a match.
3. A fresh complete host snapshot can prove execution absence only for that
   host instance.
4. A provider catalogue can prove session absence only within its declared
   complete scope and retention contract.
5. Host or provider unavailability yields `unknown`, never `absent` or `done`.
6. Working directory, repository, title, process name and timestamps are
   candidate-ranking evidence only.
7. Goal assignment survives only provider-proven continuity or explicit human
   rebind.
8. Provider-reported completion never completes a Goal automatically.
9. Resume never sends an implicit `continue` prompt after process creation.
10. A conflicting live execution blocks automatic resume.
11. A live unidentified execution for the same harness and workspace is
    candidate evidence only: it never binds automatically, but it blocks
    ordinary resume until exact evidence or explicit human resolution removes
    the ambiguity.

## Persistence

The final schema may normalize these records, but it must preserve their
lifetimes separately:

- semantic Agents and Goals;
- sensitive provider-session references and continuity observations;
- replaceable execution bindings;
- provider, site and host instance registrations;
- durable launch/resume operations and idempotency receipts;
- provider and host snapshot revisions/cursors; and
- prior bindings required for explanation and conflict diagnosis.

At normal startup, saved execution facts become unknown until refreshed. Saved
provider sessions do not become missing merely because a provider adapter has
not reconnected yet.

Database-reset tooling must distinguish:

- **semantic reset:** remove Observatory-owned Goals, assignments, Agents and
  layout, then allow provider rediscovery;
- **complete reset:** additionally remove provider/host registrations and
  operational receipts, requiring explicit reconfiguration; and
- ordinary application restart, which removes neither.

## Security and privacy

- Native transcript locations, credentials and connector tokens never enter
  browser projections or ordinary logs. The explicit Agent inspector may show
  a provider-owned ID-kind session reference for local operational diagnosis;
  path-kind references and aliases remain server-side.
- Hooks send bounded identity and lifecycle facts, not conversation content.
- Remote observations are authenticated to one accepted site/provider/host
  instance and cannot claim another instance's scope.
- Provider catalogue adapters read only the minimum metadata needed for
  discovery by default.
- Fixtures are synthetic or sanitised and contain no real session content.
- A hook or connector cannot write SQLite or accepted Universe state directly.

## Delivery plan

### Implementation note — 2026-08-28

Phase 1 is implemented for local Claude Code and Codex:

- `AgentHarness.snapshotSessions` returns scoped, metadata-only catalogue snapshots;
- Claude combines its provider index with bounded session-header metadata because live validation
  proved that `sessions-index.json` can lag current sessions;
- Codex combines `session_index.jsonl` with the `session_meta` header of rollout files;
- SQLite persists sensitive native references separately from browser-safe candidate handles;
- the full-screen Session import lens can import, assign or explicitly resume a candidate; and
- `bun run sessions:discover` provides a redacted local diagnostic path.

The catalogue persists more history than the inbox renders. The inbox currently shows the 50 most
recent unaccepted candidates per harness. Prompts, messages and tool output do not enter browser
responses. ID-kind native conversation references enter only the explicit Agent inspector;
path-kind references and aliases remain server-side.

Phase 2 is implemented:

- provider and host observations are reconciled independently before they reach the Universe;
- exact provider IDs and provider-owned path aliases are canonicalised into one scoped identity;
- accepted execution bindings are host-instance scoped, replaceable and retained as history;
- complete host snapshots produce execution absence only for that host instance, while host
  unavailability preserves unknown execution state;
- the four persisted state axes derive running, dormant, resumable, unavailable, unidentified,
  continuity-lost, stale, possibly-running and conflict UI states;
- database-wipe recovery keeps exact live sessions in Session import until explicit Import or
  Import and assign, then binds the existing execution without creating a duplicate Agent; and
- resume fails closed for duplicate exact claims and for a previous host binding that resurfaces
  without its provider identity, while per-Agent in-flight coordination and durable request
  receipts prevent replay.
- a plausible unidentified execution in the same harness and workspace projects as
  `possibly-running` and blocks ordinary resume without being promoted into identity proof.

Existing Herdr executions that expose no provider-owned session reference remain deliberately
unidentified. Working directory, title and recency are not promoted into identity proof. Starting
or restarting the underlying provider session lets its native integration report exact evidence.
Unidentified executions do retain one degraded Agent across an Observatory restart while the same
host instance continues to prove the same native execution ID; that host-only identity never gains
provider continuity or cross-host resume.

Phase 3 remains open for stronger new-launch acknowledgement, especially structured Codex start
events and recurring Claude identity repair without requiring a provider session restart.

### Phase 0 — lock the model

- Accept this specification and update the distributed-execution study so
  provider identity is no longer merely optional enrichment for managed Agents.
- Add deterministic fixtures for every recovery scenario above.
- Define provider, host, execution and observation scopes without provider
  brand checks.

Gate: the team can explain laptop restart, database deletion, remote disconnect
and remote non-portability without referring to Herdr as Agent identity.

### Phase 1 — local provider catalogue

- Add provider-session observation and recovery-candidate persistence.
- Add Claude Code and Codex metadata-only catalogue adapters.
- Add Session import without transcript ingestion.
- Preserve host-only discovery as an explicitly degraded path.

Gate: deleting a disposable Observatory database rediscovers synthetic and
sanitised local provider sessions without any Herdr processes running.

### Phase 2 — execution rebinding

- Make the accepted execution binding replaceable and host-instance scoped.
- Change host reconciliation to update executions rather than define managed
  Agent continuity.
- Implement laptop/Herdr restart recovery and exact resume into a new pane.

Gate: a machine-equivalent restart preserves Agent and Goal identity, shows
`dormant/resumable`, and creates exactly one new execution after human action.

### Phase 3 — launch identity acknowledgement

- Persist launch correlation before process creation.
- Complete Claude identity asynchronously through lifecycle observation.
- Consume Codex structured start acknowledgement where the selected runtime
  supports it.
- Keep ambiguous launches pending and repair them through catalogue snapshots.

Gate: concurrent same-cwd launches cannot bind to each other's provider
sessions and process restart cannot replay an ambiguous launch.

### Phase 4 — multiple local and remote Herdr instances

- Add stable host, provider and site instance identity.
- Run the same catalogue, workspace and Herdr capabilities through an initial
  SSH transport or outbound connector.
- Enforce destination eligibility and site-local paths.

Gate: local and remote sessions coexist; a remote-only session offers remote
resume and never offers local resume.

### Phase 5 — non-Herdr evidence

- Add a native sandbox or hosted-agent adapter only when a proven workflow
  cannot use persistent remote Herdr.
- Validate bounded lifetime, replacement and non-PTY semantics against the same
  provider-session model.

Gate: the model describes the new environment without weakening Herdr or
pretending that sessions are universally portable.

## Rejected alternatives

- **Use Herdr sessions as Agent identity.** Host restart, migration and dormant
  sessions become identity loss.
- **Preassign every provider ID.** This overrides provider ownership and is not
  supported consistently across harnesses.
- **Find the newest transcript for a cwd.** Concurrent sessions make this
  ambiguous and unsafe.
- **Depend on hooks for correctness.** Hooks are asynchronous and can be lost;
  snapshots and durable operation reconciliation remain necessary.
- **Promise cross-machine resume.** Session files, credentials and workspaces
  are often site-local.
- **Automatically resume everything after restart.** Resume can spend money,
  duplicate work or continue an interrupted turn without human intent.
- **Implement every sandbox provider now.** Remote Herdr on persistent machines
  proves the distributed seams before broader environment lifecycle work.

## Non-goals

- Transcript rendering or universal conversation ingestion.
- Automatic Goal reconstruction from provider titles, prompts or repositories.
- Silent provider-session migration between machines.
- Automatic continuation prompts after restart.
- Exposing Herdr's Unix socket remotely.
- Making execution sites, hosts or provider sessions primary Atlas nodes.
- Building a marketplace, universal scheduler or Observatory-owned multiplexer.

## Open questions

1. Which provider metadata source gives Claude Code the strongest complete
   catalogue without reading conversation bodies?
2. Should provider instance registration survive a semantic reset in a separate
   configuration file, or be explicitly reaccepted from the connector?
3. Which Codex workflows should use app-server rather than interactive CLI plus
   lifecycle observation?
4. How should provider-proven in-place succession such as `/clear` appear in
   Agent history?
5. What retention and age defaults keep Session import useful without
   hiding discoverable sessions?
6. When is an Observatory backup/export required before exposing complete reset
   in the UI?
