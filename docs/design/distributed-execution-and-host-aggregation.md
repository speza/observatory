# Distributed execution and host aggregation

Status: proposed distributed extension over the implemented local continuity foundation  
Date: 2026-08-29  
Depends on: [Observatory technical architecture](technical-architecture.md),
[Observatory plugin architecture](plugin-architecture.md),
[Provider-session continuity and execution recovery](../specs/provider-session-continuity-and-recovery.md),
[Observatory plugin system](../specs/observatory-plugin-system.md), and
[Session launch](../specs/session-launch.md)

## Purpose

Agent execution is moving from one operator-owned machine toward a mixed fleet
of local sessions, durable remote VMs, bounded cloud sandboxes and
provider-managed agent runtimes. Observatory should remain the durable view of
that work without becoming a sandbox scheduler, terminal multiplexer or agent
runtime.

This document tests the existing architecture against that world and proposes
a provider-neutral extension. It covers:

- aggregating agents from many simultaneous host instances;
- discovering work started outside Observatory;
- launching work into local or remote execution environments;
- routing workspace, terminal and lifecycle operations to the owning site;
- preserving identity and uncertainty across disconnects, restarts and
  short-lived sandboxes; and
- supporting materially different providers such as exe.dev, E2B, Modal and
  Amp orbs without putting their concepts in the trusted semantic kernel.

The proposal retains the primary product hypothesis:

```text
Goal -> Agent
```

Execution environments, host instances, repositories and worktrees may be
durable operational records and visible metadata. They are not required nodes
in the spatial universe.

## Decision summary

The intended direction is one authoritative Observatory control plane that can
aggregate many execution sites.

```text
                                  operator
                                     |
                                     v
                         +-------------------------+
                         | Observatory             |
                         |                         |
                         | Universe + projections  |
                         | attention + operations  |
                         | host/workspace registry |
                         +------------+------------+
                                      |
                    authenticated observations and capabilities
                                      |
             +------------------------+------------------------+
             |                        |                        |
             v                        v                        v
     +---------------+        +---------------+        +---------------+
     | local machine |        | exe.dev VM    |        | E2B / Modal   |
     | Herdr or tmux |        | Herdr + Git   |        | agent + Git   |
     +---------------+        +---------------+        +---------------+
                                      |
                                      v
                                provider facts
                             Claude / Codex / Pi / ...
```

The important boundaries are:

1. **Observatory is the semantic authority and the only writer of trusted
   Observatory state.**
2. **Execution remains provider-owned.** An environment provider creates or
   resumes a place to run; a session host owns agent processes and PTYs; a
   workspace provider owns repository operations where the files live.
3. **A managed Agent's continuity anchor is its scoped provider session.** A
   host instance and native execution ID identify its replaceable current
   execution, not the durable Agent.
4. **Host kind is not host identity.** Every concrete host instance receives a
   stable opaque Observatory identity.
5. **Paths are site-local.** Bare filesystem paths never identify a workspace
   outside the capability instance that owns them.
6. **Remote unavailability preserves uncertainty.** Disconnect is not process
   exit, task completion or permission to archive anything.
7. **Provisioning is a durable operation, not a spatial node.** Idempotent
   intent and provider receipts survive ambiguous outcomes and control-plane
   restarts.
8. **The browser talks only to Observatory.** It does not connect directly to
   Herdr or learn provider credentials and native terminal targets.

## What this proposal does not decide

This study does not yet select:

- a production remote transport;
- a deployment provider for the Observatory control plane;
- an automatic placement or autoscaling policy;
- an out-of-process transport or isolation model for capability plugins;
- active-active control-plane replication;
- a universal transcript protocol; or
- a new spatial representation for machines and sandboxes.

The implemented local plugin runtime is explicitly configured, in-process and
trusted. It already supplies `agent-harness` and `code-host` capabilities; this
study does not reopen that decision or imply a marketplace.

## Current implementation baseline

The 2026-08-28 provider-session continuity work implemented several foundations
that were future work in the first version of this study:

- `HostSnapshot`, host health and execution bindings carry a stable
  `hostInstanceId`;
- host reconciliation scopes absence and unavailability to one host instance;
- SQLite migrates legacy host identities and enforces live execution uniqueness
  by `(hostInstanceId, nativeId)`;
- managed Agents use scoped provider-session identity as their normal
  continuity anchor, while host-only Agents remain an explicit degraded path;
- `AgentHarness` plugins expose provider catalogues, structured start/resume
  plans and continuity proof;
- execution bindings are replaceable, retained as history and conflict-aware;
  and
- durable launch receipts survive Observatory restart, prevent request replay
  and can recover a delayed host observation without relaunching.

The remaining distributed work is not merely adding a network call. The
composition root still selects one `SessionHost` and one local workspace
provider. There is no host registry/router, site registration, remote capability
transport, execution-environment provider, provider-scoped operational
workspace reference or durable provisioning receipt. The stages below begin
from this implemented baseline.

## Terminology

The word _provider_ is too overloaded to use alone. This design distinguishes
four independent provider/capability roles, plus execution-site and connector
deployment concepts.

### Agent provider

The agent application or service executing the task, such as Claude Code,
Codex, Pi or OpenCode. Its `AgentHarness` plugin owns provider-session catalogue,
structured start and exact-resume plans, continuity proof and optional richer
facts. For a managed Agent, its scoped provider session is the normal durable
continuity anchor. The agent provider does not necessarily own the terminal or
machine.

### Execution-environment provider

A system that creates, resumes, inspects and retires execution environments.
Examples include exe.dev VMs, E2B sandboxes, Modal Sandboxes and Amp orbs.

An environment provider answers questions such as:

- Where can this task run?
- Does an environment already exist for this request?
- Is it live, paused, finished or unavailable?
- Can it be resumed, snapshotted or terminated?

It does not define Observatory's Agent identity or semantic state.

### Session host

A local owner of agent processes and interactive execution surfaces. Herdr is
the first implementation. A tmux adapter, a sandbox-native process adapter or a
provider-native agent host could implement the same `SessionHost` contract.

A session host answers questions such as:

- Which agents exist here?
- What state has the host observed?
- Can this agent be opened, prompted or closed?
- Can the host provide a terminal stream?

Herdr remains local to the PTYs it owns. A remote Observatory does not turn the
Herdr Unix socket into a public network API.

### Workspace provider

A capability that inspects and prepares repositories where their files live.
It owns directory browsing, checkout preparation, worktree creation, status and
diff inspection. The current implementation is local Git; remote execution
requires an implementation colocated with, or delegated to, the execution
site.

### Execution site

An operator-recognisable location where one or more capability instances run.
A site may be a laptop, VM, sandbox, cluster allocation or orb. It is useful for
routing, health and display, but it is not inherently a Goal or Agent.

### Observatory node connector

An optional process near an execution site that hosts remote implementations of
the same serializable capability contracts. It may translate local Herdr and
Git operations into authenticated observations and commands.

The connector is not a second semantic control plane, universal agent runtime
or `HerdrService` pass-through abstraction. It cannot write Observatory's
store. Deploying the adapter remotely must not change what the Universe or
renderer understands.

## Product requirements

### Aggregation

- One Observatory instance can show agents from many host instances at once.
- Two instances of the same host kind remain distinct even when their native
  agent identifiers collide.
- A failed host cannot stale, replace or route operations to another host.
- Existing provider sessions can appear as Session import candidates, while
  accepted but unassigned Agents enter the Inbox without an inferred Goal.
- A host may contain one agent or hundreds; an environment may contain zero,
  one or multiple host instances.

### Location-independent supervision

- Atlas, Ledger, Attention, Catch up and inspectors remain projections over the
  same Goal and Agent state regardless of execution location.
- The renderer may display site, environment, host and provider labels as
  provenance or filtering facets.
- Opening a terminal, diff or artifact routes through the accepted Agent to the
  capability instance that owns it.
- No renderer interprets provider-native IDs, remote paths or credentials.

### Durable launch and recovery

- Every launch has a caller-supplied idempotency key.
- The selected environment, workspace and host destination are explicit or
  selected by an explicit policy.
- A restart can resume an incomplete launch without creating a second
  environment or phantom Agent.
- Ambiguous provider outcomes remain `unknown` until reconciled.
- A managed launch is accepted only after exact scoped provider identity is
  known; host launch success alone does not manufacture one. A human may
  separately import a dormant provider session or accept a degraded host-bound
  execution.

### Uncertainty and human control

- Missing events, transport loss and sleeping environments are represented
  separately from confirmed process exit.
- A provider-reported task result does not complete a Goal automatically.
- Environment termination does not archive an Agent automatically.
- Destructive environment operations require explicit human intent unless an
  accepted automatic policy exists.

## Provider landscape

The providers considered here expose different execution semantics. A useful
contract must describe capabilities rather than reducing all of them to a
long-lived remote machine.

| Provider | Execution unit                            | Continuity                                                                                           | Filesystem                                                  | Process and terminal model                                                                             | Observation and connectivity                                                                                                    |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| exe.dev  | Persistent Linux VM                       | Server-like; restart preserves disk                                                                  | Ordinary persistent VM filesystem                           | SSH, systemd, Docker and arbitrary long-running processes                                              | SSH and authenticated HTTPS proxy; control-plane inspection is primarily polling, while an in-VM connector can report outward   |
| E2B      | Isolated Linux sandbox                    | Bounded continuous runtime; pause/resume can preserve filesystem and optionally memory/process state | Mutable sandbox filesystem, templates and snapshots         | Commands, background processes and reconnectable bidirectional PTYs                                    | Lifecycle API and retrying webhooks; sandbox URLs and secure access tokens; clients reconnect after pause                       |
| Modal    | Isolated container job in an App          | Bounded lifetime; a finished sandbox is replaced rather than resumed                                 | Ephemeral root, persistent Volumes and filesystem snapshots | Exec streams and optional PTY; long-running entrypoint within the sandbox lifetime                     | Lifecycle state, polling, logs, tunnels and optional sidecars; no durable event feed should be assumed without further evidence |
| Amp orbs | Thread-coupled remote development machine | Sleeps and wakes with thread, files and declared services retained                                   | Thread-scoped checkout and persistent workspace             | Shared terminal plus supervised services; unmanaged background processes are not a durability contract | Thread activity and portals wake the orb; the thread is the durable user-facing handle, not a general sandbox API               |

These differences imply that Observatory must not assume:

- every environment has an SSH server;
- every environment can outlive a task indefinitely;
- every paused environment retains processes;
- every provider emits ordered or durable lifecycle events;
- every provider supports a reconnectable PTY;
- every provider has an idempotent create API;
- every filesystem path remains valid after replacement; or
- every environment can run a permanent connector.

### Provider archetypes beyond the initial comparison

The named providers are evidence, not a whitelist. The contracts should also
remain coherent for these broader archetypes:

- **durable machine** — an operator-owned server, cloud VM or developer
  workstation whose processes and disk can outlive Observatory;
- **resumable sandbox** — an isolated environment that can pause and reconnect,
  with explicitly reported filesystem or memory continuity;
- **bounded job sandbox** — a container or microVM that finishes permanently
  and uses snapshots, volumes or artifacts to seed a replacement;
- **cluster scheduler** — Kubernetes, Nomad or a batch platform where a logical
  task can move between physical workers and pod identity is not semantic Agent
  identity;
- **hosted agent service** — a provider-managed agent with status, messages and
  artifacts but no exposed machine or PTY; and
- **local session host** — Herdr, tmux or another process host on an existing
  operator-controlled machine without provisioning.

A future adapter should be evaluated by its observed capabilities and identity
semantics, not by how closely it resembles one of the first four vendors.

### Integration participation levels

Aggregation must not require every integration to implement launch, terminal,
workspace and destructive lifecycle operations. A capability instance may
participate at any useful level:

```text
observe
  inventory, identity, status, age, provider-native link

inspect
  logs, messages, diffs, artifacts or bounded output

interact
  prompt, terminal, native handoff or another proven action

launch
  start an agent in an existing execution environment

provision
  create, resume, suspend or terminate execution environments
```

These are cumulative examples rather than a mandatory maturity ladder. A
hosted agent service may provide excellent observation, messages and launch
without exposing a terminal or workspace. A read-only Herdr connector may
provide inventory without control. Observatory should include both honestly
and render only the capabilities each Agent proves.

### Provider capability description

Provider adapters should report a small typed capability description rather
than relying on brand checks. Candidate capabilities include:

```text
execution
  exec
  background-process
  supervised-service
  sidecar

terminal
  pty
  pty-reconnect
  resize

continuity
  durable-disk
  pause-filesystem
  pause-memory
  filesystem-snapshot
  bounded-runtime(maximum)

network
  outbound-network
  private-ingress
  public-http
  private-network

observation
  complete-snapshot
  lifecycle-events
  durable-event-cursor
  poll-only
```

Capabilities are provider observations, not promises invented by Observatory.
An adapter must report unsupported or unknown when the provider cannot prove a
behavior.

## Target system shape

```text
Browser
   |
   | projections and narrow commands
   v
+--------------------------------------------------------------------+
| Observatory control plane                                          |
|                                                                    |
|  Universe              Operational control                         |
|  +----------------+    +----------------------------------------+   |
|  | Goals          |    | HostInstanceRegistry                   |   |
|  | Agents         |    | AgentHarness / provider catalogues     |   |
|  | relationships  |    | Workspace / environment registries     |   |
|  | accepted facts |    | LaunchOperationCoordinator             |   |
|  +----------------+    +----------------------------------------+   |
|          |                         |                                 |
|          +-------------+-----------+                                 |
|                        | normalized observations                    |
+------------------------+--------------------------------------------+
                         |
              authenticated capability transport
                         |
      +------------------+-------------------+
      |                                      |
      v                                      v
+---------------------------+     +---------------------------+
| execution site A          |     | execution site B          |
|                           |     |                           |
| AgentHarness catalogues   |     | AgentHarness catalogues   |
| SessionHost: Herdr        |     | SessionHost: native       |
| WorkspaceProvider: Git    |     | WorkspaceProvider: Git    |
| Environment: exe.dev VM   |     | Environment: E2B sandbox  |
+---------------------------+     +---------------------------+
```

There remains one trusted semantic write path. Distribution occurs at the
capability edge, not by giving every site a writable copy of the Universe.

## Identity model

### Implemented foundation and remaining limitation

The current model has separated host kind from host instance identity.
`HostSnapshot`, `HostHealth` and `AgentExecutionBinding` carry
`hostInstanceId`; reconciliation scopes absence, health and ordering to that
instance; and SQLite enforces uniqueness for a live execution by
`(hostInstanceId, nativeId)`. A snapshot from one Herdr instance therefore
cannot prove an execution on another instance absent.

The composition root still constructs one selected `SessionHost`. Access,
terminal, closeout, launch and refresh are injected with that one object. There
is no registry that can simultaneously instantiate, poll and route several
local or remote hosts, and current host records do not yet carry accepted site
or environment routing descriptors.

### Host instance identity

Every configured or accepted host needs a stable Observatory-owned instance ID
independent of endpoint and display name. The implemented local adapters supply
that identity today; distributed registration must establish and persist the
accepted binding.

```text
HostInstanceRef
  instanceId       stable opaque Observatory ID
  kind             adapter kind, for example "herdr"

HostDescriptor
  ref
  displayName
  siteRef?
  environmentRef?
  capabilities
```

Execution correlation is:

```text
(hostInstanceId, nativeId)
```

`nativeId` remains opaque and host-owned. `kind` selects an adapter
implementation but never establishes uniqueness. This pair identifies a
replaceable execution binding, not a managed Observatory Agent.

Host instance IDs must not be derived from a hostname, provider environment ID,
credential or Herdr session name. Those values can change or be reused. An
operator configuration or registration handshake establishes the stable ID.

### Execution environment identity

Environment provider identity is namespaced independently:

```text
ExecutionEnvironmentRef
  providerInstanceId
  environmentId       opaque provider ID
```

An environment can be replaced while an Observatory Agent remains in history.
Conversely, one durable environment can host multiple Agents over time.
Environment identity therefore must not become Agent identity.

The existing `ExecutionContainerRef` is suitable as display and related-agent
evidence, but operational routing requires a provider-scoped reference. A later
implementation should either strengthen that type or keep the operational ref
in a separate operations store and project only a safe label into the Universe.

### Workspace identity

A filesystem path is meaningful only within the provider instance that owns
it.

```text
WorkspaceRef
  providerInstanceId
  workspaceId           opaque provider identity

PreparedWorkspace
  ref
  launchLocation        opaque value understood by compatible host adapter
  repository?
  branch?
  warnings
```

`/workspace/repo` on two sandboxes identifies two different workspaces. The
control plane may display sanitized paths, but it never sends a remote path to
the local Git provider based on string equality.

### Managed Agent continuity

For supported managed harnesses, a scoped provider-session reference is the
normal continuity anchor:

```text
ProviderSessionRef
  harnessId
  continuityScopeId
  nativeConversationRef
```

The provider catalogue can observe that conversation while it is dormant; the
host can independently observe its current execution. Exact provider evidence
joins them. A new execution with the same scoped provider reference can rebind
the same Agent, while a reused host native ID cannot.

Working directory, title, timestamps and matching provider-ID text outside the
same continuity scope are candidate evidence only. They must not silently merge
Agents. A live execution without provider identity may be tracked as an
explicit degraded host-bound Agent whose continuity does not cross host
replacement.

## Core versus operational state

### Trusted semantic state

The Universe continues to own:

- Goals and human-controlled priority and lifecycle;
- accepted Agents and Goal assignments;
- scoped provider-session continuity and the current replaceable execution
  binding for each managed Agent;
- human names and descriptions;
- attention and accepted relationships;
- source, recency and uncertainty of semantic observations; and
- archive history.

### Durable operational state

The control plane additionally needs durable records that do not become map
nodes:

- host instance registrations and health;
- provider-session catalogue records, aliases and observation scope;
- prior and conflicting execution bindings required for recovery and
  explanation;
- environment provider registrations;
- workspace provider registrations;
- provider environment receipts;
- launch operation state and idempotency keys;
- observation cursors or revisions; and
- sanitized routing bindings.

Credentials, bearer tokens, SSH private keys and raw connector secrets must not
be stored in Universe records or projection payloads. Configuration should
refer to a secret source.

### Transient state

The following remain process-local or short-lived:

- open terminal stream handles;
- current polling work;
- connector socket sessions;
- browser viewport and selection;
- unaccepted capability targets; and
- retry timers.

A dropped terminal handle does not imply that the host-owned PTY stopped.

## Capability contracts

The types below distinguish the implemented local contracts from target
distributed additions.

### Per-instance session host

`SessionHost` remains the sole host seam. The implemented interface is
provider-neutral: an `AgentHarness` produces a process plan and the host
executes it.

```text
SessionHost
  snapshot() -> Effect<HostSnapshot, HostError>
  launchExecution(HostExecutionLaunchRequest) -> Effect<HostLaunchResult, HostError>
  access({ hostKind, nativeId }) -> Effect<AgentAccess, HostError>
  activate(access) -> Effect<HostActionResult, HostError>
  closeAgent(access) -> Effect<HostActionResult, HostError>
  openTerminal(access, dimensions, options?)
  openLinkedExecutionTerminal(execution, dimensions, options?)
```

```text
HostSnapshot
  hostKind
  hostInstanceId
  available
  observedAt
  agents
  diagnostics
  error?
```

Current host snapshots are treated as complete per host instance. Before a
remote host can return partial, paginated or cursor-bounded observations, the
contract must add explicit completeness and scoped revision fields. Only
absence from a complete current snapshot can detach an execution binding.

Distributed composition additionally needs a `HostDescriptor` outside the
Universe containing the stable instance ID, adapter kind, display label,
site/environment binding and supported routing capabilities.

### Host registry and router

The composition root owns a registry of per-instance hosts.

```text
SessionHostRegistry
  list() -> HostDescriptor[]
  resolve(hostInstanceId) -> Effect<SessionHost, HostRoutingError>
  snapshotAll() -> Effect<HostSnapshot[]>
```

The registry:

- isolates failures per instance;
- bounds snapshot concurrency;
- routes access and terminal operations by accepted Agent address;
- owns adapter lifecycle and configuration; and
- never merges provider payloads or writes SQLite directly.

This is routing over `SessionHost`, not a second pass-through host abstraction.

### Execution-environment provider

Environment lifecycle is independent from agent session hosting.

```text
ExecutionEnvironmentProvider
  descriptor() -> EnvironmentProviderDescriptor
  listPlacementOptions(request) -> Effect<PlacementOption[]>
  provision(request) -> Effect<ProvisionResult>
  inspect(environmentRef) -> Effect<EnvironmentObservation>
  resume?(environmentRef) -> Effect<EnvironmentActionResult>
  suspend?(environmentRef) -> Effect<EnvironmentActionResult>
  terminate?(environmentRef) -> Effect<EnvironmentActionResult>
  events?(cursor?) -> Stream<EnvironmentEvent>
```

Every optional lifecycle method is capability-gated. Observatory must not
simulate pause by terminating a provider that cannot pause, or describe a
finished Modal sandbox as resumable because an E2B sandbox is resumable.

`provision` should accept an Observatory request ID and provider-neutral
requirements. The provider may not support native idempotency; the coordinator
must persist intent before calling it and reconcile by returned ID, name or
metadata where available.

### Workspace provider

```text
WorkspaceProvider
  descriptor() -> WorkspaceProviderDescriptor
  listChoices(query) -> Effect<WorkspaceChoice[]>
  prepare(selection, requestId) -> Effect<PreparedWorkspace>
  inspectWorkingTree(workspaceRef) -> Effect<WorkingTreeReview>
  browse?(workspaceRef, location) -> Effect<DirectoryEntries>
```

The prepared workspace advertises compatible site or host constraints. The
launch coordinator validates compatibility rather than assuming that a path
prepared by one provider can be passed to any host.

### Agent harness and provider catalogue

The implemented `AgentHarness` plugin contract owns provider availability,
metadata-only session catalogues, structured start and exact-resume plans, and
continuity proof. `ProviderSessionSnapshot` declares provider instance,
continuity scope, observation time and completeness independently from a host
snapshot.

Distributed sites must transport this harness capability alongside
`SessionHost` and `WorkspaceProvider`. Provider catalogue discovery can recover
a dormant conversation when no process exists; host discovery can find a live
execution whose provider identity is not yet known. Exact scoped provider
evidence joins the two. A connector or plugin cannot write the Universe
directly.

## Remote capability transport

### Contract, not protocol, first

The provider-neutral contracts should be serializable before selecting a
transport. Local and remote implementations must pass the same conformance
tests. Transport errors map into typed capability errors without exposing SSH,
WebSocket or provider payloads to the Universe.

### Initial evidence transport

SSH is a pragmatic first transport for exe.dev and ordinary VMs:

- invoke a remote adapter command for snapshots and workspace operations;
- use a bidirectional SSH process for terminal control;
- retain host-instance routing and fingerprints in Observatory; and
- test reconnect and ambiguous command completion explicitly.

SSH is not the universal contract. E2B and Modal expose SDK streams and may not
provide or need an SSH daemon. Amp orbs expose supervised services and portals
rather than a general raw-TCP machine API.

### Connector direction

An outbound connector is the likely long-term topology for heterogeneous
sites. It avoids requiring inbound network access to every sandbox and can:

- authenticate and register one stable site or host instance;
- send snapshots or events with revisions;
- receive bounded capability requests;
- multiplex terminal frames with backpressure; and
- reconnect after pause or network loss.

This remains a hypothesis until one SSH adapter and one non-SSH sandbox adapter
demonstrate common needs.

### UI transport is not node transport

The current loopback HTTP API has exact-Origin mutation protection but no
remote host authentication or authorization model. It must not be exposed as a
connector protocol.

Browser-to-Observatory and node-to-Observatory transports have different trust
and lifecycle requirements:

```text
browser transport
  projections, user intents, terminal presentation

node transport
  host/workspace observations, provider catalogues and identity facts,
  capability calls, terminal byte relay
```

## Observation and reconciliation

### Snapshot scope

A complete host snapshot is authoritative only for one host instance. It can
update or detach execution bindings observed by that instance and cannot affect
another instance, even when both use the same adapter kind. It cannot prove a
provider conversation missing or erase the durable managed Agent.

A complete provider-session snapshot is independently authoritative only for
its declared provider instance, continuity scope and retention contract.
Absence from a partial catalogue cannot prove continuity loss.

Snapshot ordering is also per instance. Cross-machine wall clocks must not be
used to establish a global truth order. Prefer a host-local monotonic revision
or event cursor where available; retain `observedAt` for age and presentation.

### Events and polling

Provider event support ranges from retrying webhooks to polling-only APIs.
Observatory should normalize both into the same reconciliation discipline:

1. events make an instance eligible for prompt refresh;
2. events may update operational lifecycle state when their identity and order
   are proven;
3. a complete snapshot repairs missed, duplicated or reordered events; and
4. reconnect always performs a fresh snapshot before accepting absence.

Events are hints unless their provider contract proves completeness and
ordering. Event delivery must be deduplicated by provider event ID or scoped
revision when available.

### Health semantics

Host and environment health should distinguish at least:

```text
live          a current observation succeeded
sleeping      provider confirms a resumable inactive environment
finished      provider confirms execution ended
stale         last observation is older than policy allows
unavailable   transport or adapter could not establish current state
unknown       identity exists but no authoritative current state is available
```

Not every state belongs in `Agent.hostHealth`; environment and host health can
remain separate operational facts projected into an explanation. The core
invariant is that `unavailable` and `unknown` never become `done`.

### Discovery

Discovery has two independent inventories:

```text
provider catalogue                    host snapshot
durable or dormant conversations      current executions and terminals
          |                                  |
          +---------- exact evidence --------+
                             |
                  accepted binding or proposal
```

Provider sessions not yet tracked appear as bounded **Session import**
candidates rather than automatically filling the Atlas or Inbox. Current
executions without provider identity remain explicitly unidentified and may be
tracked only through the degraded host-bound path. Neither inventory infers a
Goal assignment.

The same scoped provider session observed through a replacement host execution
can rebind an existing managed Agent when exact evidence proves continuity.
Conflicting simultaneous live claims are retained and block automatic resume;
Observatory does not choose one silently.

## Distributed launch

### Why the current flow is insufficient

The local launch flow begins with a filesystem path and one selected host.
Remote execution may need to create an environment, clone or restore a
workspace, start a connector or host, and only then launch an agent. None of
those calls form one transaction.

### Implemented local launch receipt

The local coordinator already reserves a durable `requestId` receipt before
host launch, fingerprints the intent, persists pending recovery with the opaque
host execution reference and recovers a delayed observation after restart
without relaunching. An `AgentHarness` supplies a structured new-session or
exact-resume plan and proves provider continuity. A managed launch remains
pending until exact provider identity is observed; host success alone does not
manufacture or assign the Agent.

This is the correct inner transaction boundary for starting a process on an
already selected host. It does not yet cover provisioning a remote environment,
preparing a site-local workspace, registering a new host instance or recovering
a provider create call whose outcome is unknown.

### Target distributed provisioning operation

Before the first environment-provider side effect, Observatory extends the
durable operation with placement and provisioning state:

```text
LaunchOperation
  operationId
  requestId
  requestedBy
  goalIntent?
  placementIntent
  environmentProviderInstanceId
  environmentRef?
  workspaceProviderInstanceId?
  workspaceRef?
  hostInstanceId?
  hostLaunchReceipt?
  observedAgentId?
  state
  lastError?
  createdAt
  updatedAt
```

Suggested states are:

```text
requested
  -> provisioning
  -> preparing-workspace
  -> starting-host
  -> launching-agent
  -> awaiting-observation
  -> assigning
  -> succeeded

any nonterminal state
  -> outcome-unknown
  -> retrying or reconciled

confirmed failure
  -> failed

explicit human cancellation
  -> cancelling -> cancelled or outcome-unknown
```

`outcome-unknown` is essential. A timeout after `provision` or `launch` cannot
be represented as confirmed failure because the remote side effect may have
succeeded.

### Idempotency and reconciliation

Provider create APIs do not consistently expose idempotency keys. Observatory
therefore:

1. persists intent before calling the provider;
2. passes `requestId` as metadata or a deterministic name when supported;
3. persists a returned provider ID immediately;
4. on ambiguous failure, lists or inspects by receipt, name or metadata before
   retrying;
5. never retries a non-idempotent create blindly; and
6. records orphan candidates for human inspection when reconciliation cannot
   establish ownership safely.

The host launch result remains incomplete evidence. The coordinator waits for a
matching execution observation on the selected `hostInstanceId` and, for a
managed harness, exact scoped provider-session identity. Only then does it
create or locate the Observatory Agent and apply the requested Goal assignment.

### Placement

Initial placement should be explicit and human-selected:

```text
environment provider + placement option
workspace source
session host / agent kind
```

A later placement policy may propose a target based on capabilities, cost,
region, repository access or availability. It must not silently override human
priority or terminate other work. Policy decisions should be explainable and
persisted with the launch operation.

### Existing environment launch

Provisioning is optional. A launch can target:

- an existing local Herdr instance;
- a registered durable VM;
- a sleeping resumable environment;
- a newly provisioned sandbox; or
- a provider-native agent service that implements `SessionHost` directly.

The coordinator requests only the steps required by the selected capabilities.

## Terminal and interactive access

The browser continues to render terminal bytes through xterm.js while the host
owns process and PTY lifetime.

```text
browser
  -> Observatory terminal gateway
  -> route by hostInstanceId
  -> local adapter or authenticated node transport
  -> host-owned PTY
```

Remote terminal requirements include:

- bounded frame and replay buffers;
- backpressure rather than unbounded memory growth;
- explicit resize ownership;
- reconnect semantics reported per host capability;
- release that disconnects Observatory without pretending to stop the PTY;
- per-session authorization against the accepted Agent;
- revalidation of opaque target fingerprints before opening; and
- no persistence of terminal output in the Universe.

A provider without PTY support can still contribute observable Agents. The UI
should show available capabilities honestly rather than excluding the host.

## Workspace, review and artifacts

Workspace inspection runs at the site that owns the files. The browser asks
Observatory to inspect an accepted `WorkspaceRef`; the registry routes the
request to its provider.

Read-only review results should remain bounded and normalized:

- repository and branch labels;
- changed-file summary;
- bounded diff text;
- truncation and binary-file explanations; and
- observation source and age.

Large repositories, archives and provider-native artifacts should not be copied
into SQLite. An artifact capability can later return expiring or proxied access
handles without adding a universal object-store API prematurely.

## Security and trust

### Trust boundaries

Remote execution sites are less trusted than the control plane. A compromised
agent or sandbox must not be able to author trusted Goals, change priority,
archive Agents or impersonate another host instance.

Node credentials should identify:

- one connector or capability instance;
- allowed host/workspace/environment instance IDs;
- permitted observation and action methods; and
- expiration and revocation state.

### Registration

Dynamic registration is a proposal, not automatic acceptance. A new connector
can present identity and capabilities, but an operator or preconfigured policy
must accept its stable host instance binding before observations become live
trusted host facts.

### Secrets

- Provider management credentials stay at the control-plane capability edge.
- Site-local repository or model credentials remain site-local where possible.
- Connectors never return environment variables or secret files as metadata.
- Logs and diagnostics are sanitized before persistence or projection.
- Opaque access targets are short-lived and scoped to one host instance.

### Authorization

Observation and control permissions should be separate. A read-only connector
may report agents without permitting terminal input, close or environment
termination. Destructive actions require a fresh capability check and explicit
intent.

### Network exposure

Do not expose Herdr's local socket, a provider management token or the current
loopback Observatory API directly to the public Internet. Use provider-native
private connectivity, SSH, authenticated HTTPS or an outbound connector with
transport encryption.

## Failure model

| Failure                             | Required Observatory behavior                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| One host snapshot fails             | Mark only that host instance unavailable; continue reconciling others                     |
| Connector disconnects               | Preserve accepted Agents and last observations; show age and uncertainty                  |
| Environment sleeps                  | Show provider-confirmed sleeping state; reconnect and take a complete snapshot after wake |
| Environment finishes                | Record confirmed environment outcome; do not complete its Goal automatically              |
| Create call times out               | Mark operation outcome unknown and reconcile before retry                                 |
| Duplicate webhook or event          | Deduplicate by scoped event identity or repair from snapshot                              |
| Events arrive out of order          | Reject older scoped revisions; do not compare clocks across hosts                         |
| Native agent ID collides            | Keep Agents distinct by host instance                                                     |
| Host endpoint changes               | Retain stable instance identity only after authenticated rebinding                        |
| Workspace path is reused            | Route by provider-scoped workspace reference, not path string                             |
| Terminal relay drops                | Release transient relay state; do not claim the host PTY exited                           |
| Observatory restarts                | Reload operations and registrations, reconnect, snapshot, then resume safe steps          |
| Provider confirms deletion          | Mark environment gone; preserve Agent history and human archive control                   |
| Provider outcome cannot be verified | Preserve `unknown`; surface an operator reconciliation action                             |

## Scale and control-plane placement

### One authoritative writer first

Aggregating remote hosts does not require active-active Universe writers. The
first distributed architecture should retain one Observatory process and one
SQLite store. Remote sites report observations and execute capabilities; they
do not replicate or mutate semantic state.

This avoids lost updates in the current in-memory, whole-state save model. A
revisioned command log or multi-writer database is a separate decision only if
high availability or collaborative concurrent mutation becomes a demonstrated
requirement.

### Always-on versus operator-local Observatory

An operator-local control plane can aggregate remote work while it is running.
When the laptop sleeps, remote execution continues and Observatory reconciles
on return. This is valid but cannot provide continuous attention or event
capture.

An always-on Observatory deployment can receive events continuously and serve
the view from anywhere. That deployment requires authenticated browser access,
backup and operational ownership not present in the current loopback product.
Remote host support should not silently convert the loopback server into a
public service.

### Fleet behavior

For tens or hundreds of hosts:

- bound per-provider and global polling concurrency;
- add jitter and provider-aware rate limits;
- prioritize selected, working and attention-bearing Agents;
- wake sleeping environments only for explicit actions or accepted policy;
- use events to trigger refresh, not as the sole source of truth;
- retain per-instance diagnostics and observation age; and
- avoid letting one slow provider block a projection refresh.

The renderer should consume aggregated projections, not N provider requests.

## Provider mappings

### exe.dev

Likely first remote evidence path:

```text
ExecutionEnvironmentProvider  exe.dev VM API
SessionHost                   Herdr inside VM
WorkspaceProvider             Git/filesystem inside VM
Initial transport             SSH
Long-term connector           optional systemd service
```

Its persistent server model is closest to the current local assumptions. VM
names can aid reconciliation but should not be treated as guaranteed create
idempotency. Root SSH is highly privileged, so a connector with narrower
capabilities may eventually be preferable.

### E2B

```text
ExecutionEnvironmentProvider  E2B Sandbox API
SessionHost                   sandbox-native adapter or Herdr if supported
WorkspaceProvider             in-sandbox filesystem/Git capability
Transport                     E2B SDK streams, secure sandbox endpoint or connector
```

Pause and resume semantics are capabilities, not universal behavior. Lifecycle
webhooks can reduce latency but may duplicate and must be repaired against the
current sandbox state. Reconnectable PTYs make E2B a useful second adapter test
after SSH because it proves a non-SSH transport.

### Modal

```text
ExecutionEnvironmentProvider  Modal Sandbox API
SessionHost                   process/PTY adapter in bounded sandbox
WorkspaceProvider             sandbox filesystem plus Volume/snapshot support
Transport                     Modal streams/tunnels or sidecar where proven
```

A finished Modal sandbox is not a sleeping VM. Continuation generally means a
new sandbox with restored filesystem state and therefore a new environment
identity. The Observatory Agent may remain in history, but a restored native
agent session must provide explicit continuity evidence before rebinding.

### Amp orbs

```text
ExecutionEnvironmentProvider  Amp thread/orb lifecycle, if a supported API exists
SessionHost                   supervised in-orb adapter or agent-native facts
WorkspaceProvider             orb checkout/filesystem capability
Transport                     authenticated portal/service mechanism
```

Orbs demonstrate the target product need but are not currently documented as a
general sandbox-management API. The Amp thread is a durable user-facing unit,
and an orb sleeps and wakes around it. Observatory integration should use
supported APIs rather than infer machine identity or rely on unmanaged
background processes.

### Local Herdr and tmux

Local execution remains a first-class instance, not a special semantic mode.
It uses the same host instance identity, registry routing and conformance tests
without network transport. This provides deterministic evidence before remote
failure modes are introduced.

## User experience

The spatial universe remains Goal-centred. Location is supporting evidence:

- Agent cards can show a compact site/host label and health age.
- Inspector details can show environment, host, workspace and agent-provider
  provenance separately.
- Filters can include site, host kind, provider, repository and health.
- Session import aggregates untracked provider sessions from accepted provider
  instances; the Inbox aggregates accepted unassigned Agents regardless of
  their current execution host.
- Attention can explain `host unavailable`, `environment sleeping` or
  `observation stale` without implying task failure.
- Launch UI initially requires an explicit destination and shows its
  capabilities, expected continuity and destructive lifecycle implications.
- Terminal and review actions appear only when the selected Agent's routed
  capabilities prove support.

Machines and sandboxes should not become planets by default. A later fleet lens
may visualize execution infrastructure for operational diagnosis without
changing the main semantic topology.

## Contract and test evidence

### Per-host conformance

Every production `SessionHost` implementation continues to pass shared tests
for:

- snapshot validity and completeness;
- opaque target handling and revalidation;
- launch correlation;
- access capability honesty;
- terminal frame, input, resize and release behavior; and
- unavailable-host behavior.

### Aggregation tests

Current deterministic coverage already proves that one host instance cannot
prove another instance's execution absent, provider continuity survives
execution replacement, execution history persists, and durable launch receipts
recover without relaunching.

Before remote transport, add the remaining aggregation evidence:

1. two same-kind host instances can expose the same native execution ID without
   collision;
2. unavailable and out-of-order state is scoped independently per instance;
3. access, terminal, close and linked execution route to the owner through the
   registry;
4. one failed snapshot does not block successful instances;
5. launch cannot match an execution or provider session from another selected
   destination or continuity scope;
6. workspace references cannot cross provider instances; and
7. persistence restart preserves site registrations and routing bindings as
   well as existing Agent identity and assignments.

### Distributed operation tests

Use fault injection to exercise:

- timeout before and after provider side effect;
- duplicate create response or webhook;
- control-plane restart at every launch state;
- provider ID returned but not persisted;
- connector disconnect during terminal and snapshot;
- sleeping environment that resumes with changed endpoint;
- replaced container with reused path or native process ID; and
- explicit cancellation racing with successful launch.

### Live smoke paths

Each provider adapter needs a bounded, sanitized smoke path that proves only
its claimed capabilities. The smoke should create or select an environment,
observe an agent, route one safe interaction where supported, disconnect,
reconnect and clean up only resources created by the test.

## Delivery from the current implementation

### Implemented migrations and invariants

The current SQLite migrations already:

- backfill legacy executions with a deterministic host instance ID;
- key host health by `host_instance_id` while retaining `host_kind`;
- enforce live execution uniqueness by `(host_instance_id, native_id)`;
- persist scoped provider-session records and aliases;
- separate provider continuity from replaceable execution bindings;
- retain prior and conflicting executions; and
- persist launch receipts and pending recovery state.

Future site, environment and workspace migrations must preserve all existing
Agent IDs, provider-session bindings, assignments, names, archive state, layout,
execution history and launch receipts. Attaching a second host or provider
instance remains explicit; migration must not guess identity from endpoints,
paths or matching native IDs.

### Staged delivery

#### Foundation — implemented local continuity

- Agent-harness plugin registry and scoped provider catalogues.
- Host-instance-scoped execution binding and absence reconciliation.
- Durable launch and resume receipts with restart recovery.
- Session import, exact rebinding and degraded host-only compatibility.

Evidence already established: host restart, provider-session rediscovery,
delayed launch observation and one host instance not proving another absent.

#### Stage 1 — simultaneous host composition and routing

- Add `SessionHostRegistry` descriptors and route every gateway through the
  accepted execution binding's `hostInstanceId`.
- Run two mock hosts plus local Herdr concurrently through the registry.
- Isolate polling, diagnostics and failure per host instance.

Evidence gate: same-kind instances can collide on native execution ID without
affecting identity or health, and every action reaches the owning instance.

#### Stage 2 — site and locality-safe capability composition

- Add accepted site identity and bind host, harness/provider and workspace
  capability instances to it.
- Replace bare operational paths with provider-scoped workspace references.
- Make host, provider continuity scope and workspace destination explicit.
- Transport provider catalogues and continuity evidence alongside host and Git
  capabilities.

Evidence gate: a remote-only provider session never appears locally resumable,
and no remote path is interpreted by the local workspace provider.

#### Stage 3 — exe.dev SSH walking slice

- Add one configured remote host and workspace provider over SSH.
- Route provider catalogue, discovery, diff and terminal access to the VM.
- Preserve loopback browser operation initially.
- Exercise disconnect, endpoint change and control-plane restart.

Evidence gate: local and remote Herdr executions coexist in one Observatory;
the same provider session remains one Agent only with exact scoped continuity,
and all actions reach the owning site.

#### Stage 4 — environment provisioning and a non-SSH sandbox adapter

- Extend durable launch operations around environment provisioning and
  site-local workspace preparation.
- Implement E2B or Modal lifecycle and capability transport.
- Prove bounded lifetime, pause or replacement semantics.
- Reconcile provider lifecycle events against complete snapshots.

Evidence gate: the contracts describe a sandbox without pretending it is a
persistent SSH machine, and an ambiguous create outcome cannot duplicate an
environment or managed Agent.

#### Stage 5 — connector and always-on evaluation

- Compare repeated provider adapters with an outbound node connector.
- Add authenticated browser access only if an always-on Observatory is chosen.
- Measure fleet polling, event volume and terminal relay behavior.

Evidence gate: a connector removes demonstrated duplication and retains the
same contracts; it is not introduced only for architectural symmetry.

## Alternatives rejected

### Run one Observatory per sandbox and merge only in the browser

This fragments semantic authority, Goal identity, archive history and human
decisions. The browser would become a distributed data reconciler rather than a
renderer.

### Treat every sandbox as a `SessionHost` kind

Encoding kinds such as `herdr-exe`, `herdr-e2b` or `herdr-orb` avoids collisions
temporarily but conflates transport, infrastructure and process host. It causes
an unbounded kind taxonomy and prevents two instances of the same combination.

### Expose Herdr's Unix socket remotely

The socket is local, powerful and tied to Herdr's machine-level lifecycle. A
raw tunnel would expose Herdr details, omit workspace and environment
capabilities, and make authentication an accidental transport concern.

### Model environments as mandatory Universe nodes

This would displace the Goal-centred spatial hypothesis with infrastructure
topology. Environment information is important operational metadata and may
deserve a supporting fleet lens, but it is not the primary organization of
work.

### Make `SessionHost` provision every environment and workspace

That creates a universal provider/terminal/workspace API and couples Herdr to
cloud lifecycle. Keeping environment, host and workspace capabilities distinct
allows compositions such as Herdr on exe.dev, a native E2B host, or local Herdr
without provisioning.

### Distribute the Universe database to every connector

Multi-host aggregation needs distributed observations, not multi-writer
semantic state. Replication would add conflict resolution and authorization
before it solves a demonstrated product requirement.

## Open questions

The following require evidence before implementation choices become accepted:

1. Is a configured pull adapter sufficient for the first remote workflows, or
   is continuous outbound connection required immediately?
2. Should environment and host registrations be human-accepted durable state,
   configuration, or both?
3. Which operational launch fields belong in SQLite versus a provider plugin's
   state store?
4. How should restored provider-native agent sessions propose continuity with
   a previous Observatory Agent?
5. What is the minimum useful Agent experience for providers without PTY
   access: status, logs, messages, artifacts or provider-native links?
6. Which observation age policies vary by provider, environment state or Agent
   runtime state?
7. Should one remote connector represent a whole site with multiple hosts, or
   should each host register independently over a shared transport?
8. What backup, authentication and availability requirements are necessary
   before Observatory itself can run remotely?
9. When does fleet scale justify incremental persistence rather than the
   current whole-state save path?
10. Which provider should prove the non-SSH model first: E2B's reconnectable
    PTY and lifecycle events or Modal's bounded replacement model?

## Evaluation criteria

The architecture is successful when:

- one Observatory accurately aggregates local Herdr plus at least two remote
  execution models with different lifecycle semantics;
- provider or host loss cannot corrupt accepted semantic state;
- every Agent action routes to the owning capability instance;
- restart and ambiguous outcomes do not duplicate environments or Agents;
- the browser and Universe remain provider-neutral;
- location and health improve understanding without replacing Goal -> Agent;
- a provider without terminal support can still contribute useful Agents; and
- replacing one environment provider does not require changes to spatial,
  projection or semantic modules.

The architecture has failed if the operator must open each provider dashboard
to understand active work, if native IDs collide across hosts, if remote paths
are inspected locally, or if a disconnected sandbox is presented as completed
work.

## References

### Observatory

- [Observatory technical architecture](technical-architecture.md)
- [Observatory plugin architecture](plugin-architecture.md)
- [Goal-centred agent orchestration map](agent-orchestration-map.md)
- [Session launch](../specs/session-launch.md)
- [Agent harness plugins](../specs/agent-harness-plugins.md)
- [Provider-session continuity and execution recovery](../specs/provider-session-continuity-and-recovery.md)
- [Observatory plugin system](../specs/observatory-plugin-system.md)
- [Agent execution model](../specs/agent-execution-model.md)
- [Agent closeout and host lifecycle](../specs/agent-closeout-and-host-lifecycle.md)

### Herdr

- [Herdr socket API](https://herdr.dev/docs/socket-api/)

### exe.dev

- [exe.dev documentation](https://exe.dev/docs/all)
- [exe.dev API](https://exe.dev/docs/api)
- [exe.dev HTTPS API](https://exe.dev/docs/https-api)

### E2B

- [Sandbox lifecycle](https://e2b.dev/docs/sandbox)
- [Persistence, pause and resume](https://e2b.dev/docs/sandbox/persistence)
- [Lifecycle events API](https://e2b.dev/docs/sandbox/lifecycle-events-api)
- [Lifecycle webhooks](https://e2b.dev/docs/sandbox/lifecycle-events-webhooks)
- [Interactive PTY](https://e2b.dev/docs/sandbox/pty)

### Modal

- [Modal Sandboxes](https://modal.com/docs/guide/sandboxes)
- [Modal Sandbox API](https://modal.com/docs/sdk/py/latest/Sandbox)
- [Modal VM Sandboxes](https://modal.com/docs/guide/vm-sandboxes)

### Amp

- [Amp orbs](https://ampcode.com/docs/orbs)
- [Amp orb portals](https://ampcode.com/docs/orbs/portals)
