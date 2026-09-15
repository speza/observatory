# Agent-directed delegation and relationship capture

Status: proposed product and architecture slice

Updated: 2026-09-15

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Agent launch and workspace preparation](session-launch.md)
- [Agent harness plugins](agent-harness-plugins.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Structured conversation interaction](structured-conversation-interaction.md)

## Product decision to test

Let an accepted Agent request bounded child-Agent launches through Observatory.
The requesting Agent decides whether to delegate, how many children it needs,
which approved launch profiles to use and what task each child receives.
Observatory validates a human-approved grant, performs every launch through the
existing provider-neutral launch path and records the exact causal relationship
when the child's provider conversation identity is proved.

This is agent-directed delegation, not an Observatory workflow engine:

```text
human grants bounded delegation authority
                    |
                    v
            accepted parent Agent
             decides its strategy
                    |
                    v
        Observatory delegation capability
          |       |              |
          |       |              +--> durable provenance
          |       +--> StartAgentCoordinator
          +--> grant validation          |
                                         v
                          AgentHarness -> SessionHost -> Herdr
                                         |
                                         v
                              exact child conversation
                                         |
                                         v
                         accepted delegated-to relationship
```

Observatory owns the safe mechanism, identity join, authority and projection.
It does not encode that code review requires correctness, standards and
specification reviewers, decide when a synthesizer is needed or maintain a DAG
of domain-specific tasks. Those choices stay in the delegating Agent and the
skills available to it.

The first live host remains Herdr, but delegation is not a Herdr protocol
concept. A future `SessionHost` must be able to execute the same structured
launch without changes to the delegation model or renderer.

## Why

An Agent can already use Herdr commands to create more terminal agents. That is
operationally useful but leaves Observatory unable to answer:

- which accepted Agent requested the new work;
- whether the launch was authorized;
- what role the child was asked to perform;
- which pending execution eventually became the exact child conversation; and
- which Agents should be presented together during supervision.

Encoding each orchestration pattern in Observatory would recover that context
at the cost of making Observatory a planner and workflow runtime. A generic,
scoped delegation capability provides the relationship evidence without moving
strategy into the control plane.

The intended promise is:

> Agents may choose and launch bounded collaborators; Observatory keeps the
> resulting work attributable, inspectable and under human authority.

It is not:

> Observatory autonomously decomposes Goals, routes work or decides that a team
> has succeeded.

## Worked example: heterogeneous code review

An operator starts a lead reviewer under the Goal `Review authentication
change` and grants it permission to launch at most three children from approved
Codex, Claude and Pi profiles.

The lead's installed delegation skill instructs it to request:

```text
correctness reviewer     -> Codex profile
standards reviewer       -> Claude profile
specification reviewer   -> Pi profile
```

Each request contains a bounded role and prompt, but no parent Agent id, Goal
id, native provider reference or Herdr target. The local delegation capability
obtains those from its scoped context. Each request reuses the normal launch
coordinator and receives a durable idempotency id.

As provider identities arrive, Observatory resolves the three launch receipts
to exact Agents, places them according to the approved policy and records:

```text
Lead reviewer
  delegated-to -> Correctness reviewer
  delegated-to -> Standards reviewer
  delegated-to -> Specification reviewer
```

The Agents may use different harnesses, models, worktrees and eventually hosts.
Those remain metadata. The shared Goal and typed delegation relationships make
the collaboration coherent.

The first slice does not aggregate reviewer text or declare the review passed.
Result handoff is a separate capability and must not be implemented by scraping
terminal output or ingesting transcripts.

## Additional examples

These examples test whether one generic delegation mechanism supports useful
work without encoding their recipes in Observatory.

### Independent diagnosis

A lead investigating an intermittent test failure delegates three bounded,
read-only investigations:

```text
Lead investigator
  -> reproduce on the current branch          (Codex profile)
  -> inspect concurrency and ordering paths   (Claude profile)
  -> search history for related regressions   (Pi profile)
```

All children inherit the approved Goal and parent workspace. Their launch
profiles prevent writes. Observatory shows that the investigations were
independently requested, but does not claim that matching conclusions are true
or that disagreement requires a deciding vote.

### Implementation followed by adversarial review

A lead delegates one implementation into an approved isolated worktree. After
receiving evidence through an explicit channel outside this first slice, it may
request a separate read-only reviewer:

```text
Lead Agent
  -> implement cache invalidation fix       (Claude write profile, worktree A)
  -> review the resulting change            (Codex read-only profile, worktree A)
```

The second launch is another decision by the lead, not a dependency edge that
Observatory schedules automatically. Shared-worktree overlap is visible risk
evidence; the delegation relationship does not make concurrent writes safe.

### Cross-repository Goal

A Goal to update one protocol across a server and client repository delegates
one child into each explicitly approved workspace:

```text
Protocol migration lead
  -> update server encoder       (server repository)
  -> update TypeScript client    (client repository)
  -> check compatibility docs    (read-only documentation workspace)
```

The Goal provides semantic unity while repositories remain Agent metadata. The
grant must enumerate or otherwise bound each workspace; the child cannot choose
an arbitrary local path merely because the Goal spans repositories.

### Partial provider availability

A lead requests two approved independent reviewers. The Claude profile starts,
but the Codex harness is unavailable:

```text
Lead reviewer
  -> security reviewer     active
  -> compatibility reviewer failed: approved harness unavailable
```

Observatory preserves one successful relationship and one failed operation. It
does not silently substitute another model, exceed the grant with a retry or
report the review set complete. The lead or operator may make a new explicit
request using another approved profile.

### Deliberate non-delegation

A small, sequential task does not justify another Agent. The installed skill
should tell the parent to continue directly rather than treating available
capacity as a reason to spawn work. Agent count is not a success metric.

## Product invariants

1. The durable topology remains `System -> Goal -> Agent`, with optional direct
   `System -> Agent` placement. A team, run, role or delegation tree is not a
   new organisational parent.
2. Only an accepted, exactly identified Agent with a current authorized
   delegation context may request a child launch.
3. The server derives the parent from that context. A caller cannot submit an
   arbitrary `parentAgentId`, Goal id or host-native target.
4. A delegation request creates no phantom child Agent. The child relationship
   is accepted only after the normal launch path proves exact provider
   conversation identity.
5. Human authority is explicit. Goal inheritance, launch profiles, workspace
   scope, child count, concurrency and recursive delegation are bounded by a
   grant approved by the operator.
6. A relationship proves causal delegation, not successful task completion,
   agreement between Agents or trustworthy integration.
7. Provider, model, host, repository, worktree, tab and pane remain Agent or
   launch metadata, never relationship identity or topology.
8. Missing, delayed, failed and conflicting evidence remains visible. A launch
   timeout does not prove that no child was created and must not be retried with
   a new identity automatically.
9. Direct host launches are not silently called delegation. Passive host
   lineage, if added later, is observed evidence or a proposal until exact
   Agent identities and an authority policy accept it.
10. Delegation does not permit automatic Goal completion, Agent archive, merge,
    approval, permission response or destructive host action.

## Authority model

### Delegation grant

A grant is an explicit operator policy attached to one parent Agent. A possible
shape is:

```ts
interface DelegationGrant {
  readonly id: string;
  readonly parentAgentId: AgentId;
  readonly allowedLaunchProfileIds: readonly string[];
  readonly placement:
    | { readonly kind: "goal"; readonly goalId: GoalId }
    | { readonly kind: "system"; readonly systemId: SystemId }
    | { readonly kind: "inbox" };
  readonly workspacePolicy: "parent-workspace" | "approved-selection";
  readonly maximumChildren: number;
  readonly maximumConcurrentChildren: number;
  readonly maximumDepth: number;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly revokedAt?: number;
}
```

The initial UI should default to:

- current Goal placement when the parent has a Goal, otherwise Inbox;
- the parent's trusted workspace;
- a small maximum child count and concurrency limit;
- an explicit allow-list of launch profiles; and
- no recursive delegation (`maximumDepth: 1`).

Changing the parent's later placement does not silently widen a fixed grant.
Archived, expired, revoked, conflicting or execution-unknown parents cannot use
it. Revocation prevents new requests but does not stop or archive existing
children.

### Runtime capability

A live parent receives an opaque, scoped capability context. The implementation
may expose it to a supported local process as an environment value, but its
contents are never interpreted by the Agent and it must be redacted from
process plans, diagnostics, projections and fixtures.

The context resolves server-side to the grant and exact parent execution. It is
invalid after revocation, expiry, execution replacement or identity conflict.
Possession grants only the declared delegation operations; it is not a general
Universe, browser API or SessionHost credential.

The capability is intended authority available to the Agent and therefore to
code the Agent executes. Bounds and revocation, rather than secrecy from the
Agent itself, provide control. Installation of a skill does not grant this
capability.

### Launch profiles

A launch profile is a stable, browser-safe choice approved by the operator. It
selects an installed harness and bounded harness-owned options, which may
include a model choice where that harness supports one.

The delegating Agent chooses only among profile ids in its grant. It cannot pass
arbitrary executable names, environment variables, provider credentials or
unrestricted native arguments. Harness plugins continue to own provider command
construction and `SessionHost` continues to own process placement.

The projection distinguishes requested configuration from observed facts. A
requested model is not displayed as the actual model unless provider evidence
confirms it.

## Durable records

The operation must survive Observatory restart and delayed child identity. A
provisional shape is:

```ts
type DelegationStatus = "requested" | "launching" | "active" | "failed" | "uncertain" | "ended";

interface DelegationRecord {
  readonly id: string;
  readonly requestId: string;
  readonly grantId: string;
  readonly parentAgentId: AgentId;
  readonly childAgentId?: AgentId;
  readonly launchProfileId: string;
  readonly role?: string;
  readonly taskSummary?: string;
  readonly placement: LaunchGoal;
  readonly createdAt: number;
  readonly status: DelegationStatus;
  readonly provenance: "agent-requested";
}
```

`role` and `taskSummary` are bounded, untrusted Agent-authored annotations with
visible provenance. The full prompt is operational launch input and is not
stored as relationship metadata, included in diagnostics or projected globally.

The delegation operation store may be separate from the Universe snapshot, as
launch receipts are today. Once both exact Agents exist, the Universe owns the
accepted typed `delegated-to` relationship through a normal command. The
coordinator must recover the join idempotently if Observatory stops after host
launch, child admission or relationship persistence.

A relationship is directional and immutable in meaning:

```ts
interface AgentDelegation {
  readonly id: string;
  readonly parentAgentId: AgentId;
  readonly childAgentId: AgentId;
  readonly role?: string;
  readonly requestedAt: number;
  readonly provenance: "agent-requested";
}
```

Archiving or reassigning either Agent does not rewrite historical delegation.
Active projections may hide ended or archived work according to their existing
rules, while history and inspector views retain the relationship.

## Delegation coordinator

Add one deep coordinator at the imperative edge. It composes existing ports
rather than widening `SessionHost` with a team operation.

For a new request it:

1. resolves and revalidates the scoped parent capability;
2. checks grant expiry, placement, profile, workspace, count, concurrency and
   depth;
3. reserves an idempotent delegation record;
4. derives one ordinary `StartAgentIntent` with the approved placement,
   workspace and launch profile;
5. invokes `StartAgentCoordinator.start`;
6. stores pending, failed or uncertain launch evidence without inventing a
   child Agent;
7. on exact identity, records the child id and submits the typed Universe
   relationship command; and
8. publishes a bounded projection change after persistence succeeds.

The delegation `requestId` deterministically scopes the underlying launch
request. Repeating the same request returns the existing operation; reusing it
with different role, prompt fingerprint, profile or placement is rejected.
An uncertain host outcome is reconciled from the existing launch receipt and
observations, never repaired by blindly launching again.

The coordinator does not:

- decompose tasks;
- select a profile when the Agent did not name one;
- wait for or interpret the child's answer;
- launch a synthesizer when siblings finish;
- infer success from runtime state; or
- complete, archive, merge or stop related work.

## Agent-facing CLI

Provide a small local CLI backed by the coordinator. The exact spelling remains
an implementation detail, but the first contract should resemble:

```sh
ao delegation capabilities --json
ao delegation launch \
  --request-id review-correctness-1 \
  --profile codex-review \
  --role correctness-reviewer \
  --prompt-file /path/to/bounded-prompt.txt \
  --json
ao delegation list --json
ao delegation get <delegation-id> --json
```

The CLI:

- obtains authority from its injected context;
- never accepts parent Agent, native conversation or host target ids;
- emits versioned structured output suitable for an Agent to parse;
- keeps prompts out of command arguments where practical;
- bounds prompt, role and summary sizes;
- distinguishes accepted, pending, failed and uncertain outcomes; and
- does not claim that lifecycle settlement is a structured result.

A future wait operation may wait for typed lifecycle or result evidence, but it
must name which condition was observed. `waited` or process exit alone cannot
mean the delegated task succeeded.

## Installed Agent skill

Ship a canonical Agent Skills-compatible skill named
`observatory-delegation`. It is a thin instruction layer over the CLI, not a
source of authority and not a catalogue of workflows.

The skill teaches an Agent to:

- inspect its available grant and launch profiles before delegating;
- delegate only when parallelism or specialization justifies another Agent;
- give each child one bounded role and task;
- use stable request ids and inspect uncertain operations before retrying;
- respect child, concurrency, workspace and recursion limits;
- avoid claiming child success from host state;
- report unresolved or blocked children to the operator; and
- fall back honestly when delegation or a desired profile is unavailable.

Observatory should provide an explicit, inspectable installation command, for
example:

```sh
ao skills install delegation
```

The canonical skill may be installed into a shared Agent Skills location such
as `~/.agents/skills/observatory-delegation/`, with harness-specific
installation adapters only where a supported harness cannot consume that
location. Observatory must not silently edit provider configuration. Skill
health is reported as installed, missing or unsupported independently from the
runtime grant.

Installing the skill does not automatically enable delegation. Conversely, an
Agent with a grant but no skill may call the documented CLI directly.

## Projection and renderer

Delegation is a semantic overlay on the existing views.

Initial presentation should provide:

- `Delegated by <Agent>` and role metadata in the child inspector;
- a bounded parent-and-children section in the parent inspector;
- role and delegated markers on Agent rows/cards;
- sibling and parent highlighting when one relationship is selected; and
- explicit launching, failed and uncertain placeholders tied to delegation
  operations, not phantom Agent cards.

Atlas remains workspace-first. It does not create a team island, re-parent cards
under the delegator or draw every relationship continuously. A selected
relationship may use a subtle overlay across existing territories. Ledger may
group or annotate related Agents without changing its canonical Agent order.

The first slice does not collapse Needs-you items into a parent decision or
claim `two of three returned`. Such composition requires a typed result or turn
outcome with defined freshness. Existing Agent-level attention remains
truthful.

## Cross-provider behaviour

Delegation is intentionally harness-neutral. One parent may request children
from several approved profiles:

```text
Parent: Claude harness
  -> child: Codex harness
  -> child: Pi harness with an approved model option
  -> child: another Claude profile
```

The relationship remains the same across all combinations. Harness availability
or failure is reported per child operation. No automatic provider fallback is
performed in the first slice: substituting another profile changes cost,
capability and independence and therefore requires a new explicit request or a
future separately approved routing policy.

Provider and model diversity may be shown as descriptive metadata. Observatory
does not assert that diversity guarantees independent reasoning or higher
quality.

## Passive host lineage

A future host may report that one execution requested creation of another.
That can improve discovery for Agents that bypass the Observatory CLI, but it
must use a provider-neutral, provenance-bearing observation at the
`SessionHost` seam. Herdr pane, tab and command identifiers remain inside its
adapter.

Passive lineage alone does not establish accepted delegation because:

- process ancestry or shared terminal context may not represent conceptual
  delegation;
- either execution may lack exact conversation identity;
- the caller may not have had an approved inheritance policy; and
- another host may not provide equivalent evidence.

The initial implementation therefore accepts exact relationships only from the
scoped Observatory delegation capability. Passive capture is deferred until a
real workflow proves its value.

## Result handoff boundary

Delegation launch and relationship capture do not require transcript access.
Autonomous aggregation does.

The first slice must not add `delegation result` by:

- reading arbitrary terminal scrollback;
- parsing ANSI or alternate-screen state;
- scraping provider transcript files;
- persisting complete prompts or responses; or
- treating a provider `done` or host `idle` state as a result.

A later bounded result-artifact capability may be considered if the code-review
trial shows that parent Agents need to synthesize child work. It must define
identity, size, acknowledgement, provenance, privacy and failure semantics and
remain distinct from accepted Goal completion. The feasibility and privacy
constraints in
[Structured conversation interaction](structured-conversation-interaction.md)
continue to apply to provider-native answers.

Until then, the operator may inspect child terminals and review evidence
through existing surfaces. Agent skills that coordinate through Herdr-specific
read commands remain host-specific workflows outside this delegation contract.

## Failure semantics

- Invalid, expired or revoked grant: reject before launch.
- Parent execution absent, replaced, conflicting or unknown: reject rather than
  attributing the request to stale identity.
- Disallowed profile, workspace, placement, depth or limit: reject with the
  violated bound.
- Host unavailable before placement: persist the failed operation and do not
  claim a child.
- Host accepts placement but child identity is delayed: show one pending
  delegation and continue canonical reconciliation.
- Host outcome is unknown: preserve uncertainty and do not retry automatically.
- Child identity conflicts: retain the operation and conflict; do not attach the
  relationship to a guessed Agent.
- Exact child exists but relationship persistence fails: leave a recoverable
  operation and retry the idempotent Universe command without relaunching.
- Grant is revoked after launch: preserve the child and relationship; prevent
  further launches.
- Child is moved, becomes dormant or is exactly resumed: preserve the durable
  relationship independently from execution binding.
- Plugin or harness disappears: leave accepted relationships intact and report
  future launch capability unavailable.

## Security and privacy

- Bind the CLI to the existing local control-plane authority; do not expose
  delegation remotely.
- Scope runtime capabilities to one parent execution and one persisted grant.
- Rotate or invalidate capability material after execution replacement,
  revocation and expiry.
- Never place capability values, full prompts, provider references or native
  host targets in logs, diagnostics, projections or fixtures.
- Accept prompts through bounded files or standard input rather than process
  arguments where practical.
- Treat role, summary and all Agent-authored labels as untrusted display data.
- Build launches from structured harness plans, never shell command strings.
- Rate-limit requests in addition to durable count and concurrency bounds.
- Do not let a delegated Agent widen its own grant or grant delegation to
  another Agent unless recursive authority was explicitly approved.
- Keep all fixtures synthetic and include sentinel tests proving secret values
  do not reach persistence or diagnostics.

## Delivery slices

### Slice 0: mock capability and product trial

- Add a synthetic delegation grant, coordinator and deterministic mock-host
  flow.
- Reuse `StartAgentCoordinator`; do not add a team method to `SessionHost`.
- Project parent, pending children and exact resolved children in a mock
  inspector.
- Exercise a heterogeneous three-reviewer scenario without result aggregation.

Gate: the operator can explain who delegated each child and reach every child
without consulting Herdr topology.

### Slice 1: durable operation and Universe relationship

- Persist grants and idempotent delegation operations.
- Add the typed `delegated-to` Universe command and invariants.
- Recover requests across delayed identity and Observatory restart.
- Add projection and SQLite contract coverage.

Gate: no crash point can create a duplicate launch, phantom Agent, guessed
relationship or silent Goal inheritance.

### Slice 2: local CLI and installed skill

- Expose versioned JSON capability, launch, list and get commands.
- Inject a scoped context only for eligible accepted parent executions.
- Ship the canonical `observatory-delegation` skill and explicit installer.
- Validate Pi plus at least one other supported harness consuming the same
  semantic instructions.

Gate: a lead Agent can choose and launch heterogeneous children without direct
Herdr commands, and Observatory records every exact relationship.

### Slice 3: live Herdr validation

- Launch disposable parent and child Agents through the real adapter.
- Exercise mixed harness profiles, delayed identity, revocation, count limits,
  host loss, restart and exact child resume.
- Verify that Herdr identifiers remain inside the adapter and that direct Herdr
  launches do not gain invented delegation.

Gate: the live flow matches mock evidence and leaves no disposable processes,
panes or private content.

### Slice 4: result handoff feasibility

- Observe the code-review workflow before defining another interface.
- Compare explicit bounded artifacts, supported provider structured results and
  human-only synthesis.
- Apply the structured-conversation feasibility and privacy gates.

Stop if a trustworthy common result cannot be obtained without transcript or
terminal scraping. Delegation remains valuable as a supervisory relationship
without autonomous aggregation.

## Verification expectations

A maintained implementation requires:

- grant tests for expiry, revocation, placement, profile, workspace, count,
  concurrency and recursion;
- idempotency and crash-recovery tests around every launch and relationship
  persistence boundary;
- exact identity, delayed identity, replacement and conflict tests;
- shared mock and Herdr `SessionHost` contract coverage without a host-specific
  delegation method;
- cross-harness tests proving no provider switches enter the coordinator,
  Universe, projection or renderer;
- CLI schema, malformed input, rate-limit and capability-scope tests;
- sentinel privacy tests for prompts, tokens and provider references;
- projection and browser tests for pending, failed, uncertain and resolved
  relationships; and
- a disposable live smoke path with explicit cleanup.

Normal `bun run format`, `bun run check` and `bun test` gates apply to any
implementation.

## Success criteria

The slice succeeds when:

1. a lead Agent can request collaborators without directly controlling Herdr;
2. Observatory maintains no domain-specific orchestration recipe;
3. every accepted child relationship has exact parent, child, grant and launch
   provenance;
4. heterogeneous harnesses and approved model profiles use the same delegation
   contract;
5. the operator can understand the delegation shape and unresolved work faster
   than reconstructing tabs and panes;
6. disabling delegation loses launch convenience but does not damage accepted
   Agents, Goals or existing relationships; and
7. uncertainty, lifecycle and completion remain honest throughout failure and
   restart.

## Rejected alternatives

- **Add Team as a topology node.** A team is an execution pattern around a Goal,
  not a stable replacement for `System -> Goal -> Agent`.
- **Encode review and other playbooks in Observatory.** This makes the control
  plane maintain task-decomposition policy and tends toward a workflow engine.
- **Let an Agent call `SessionHost` directly.** It bypasses launch receipts,
  exact identity reconciliation and Universe authority.
- **Teach the generic skill raw Herdr commands.** That couples the workflow to
  the first host and cannot reliably create accepted semantic relationships.
- **Infer delegation from shared workspace, repository, provider or timing.**
  Those are related-Agent evidence, not causality.
- **Accept a caller-supplied parent Agent id.** It permits false attribution.
- **Allow arbitrary harness arguments or automatic provider fallback.** That
  bypasses the approved capability and can change cost or behaviour silently.
- **Treat child process completion as task success.** Runtime state is evidence,
  not acceptance or a result contract.
- **Scrape terminal or transcript content for aggregation.** This violates the
  current privacy and provider-authority boundaries.

## Non-goals

- An autonomous planner, scheduler or generic DAG runtime.
- A durable Team, Run, Task or Workstream hierarchy.
- Automatic task decomposition, profile selection or load balancing.
- Cost optimization, quotas or billing normalisation beyond explicit safety
  bounds.
- Provider-native subagent graph ingestion.
- General Agent-to-Agent chat or message routing.
- Transcript ingestion, terminal parsing or automatic result synthesis.
- Automatic completion, archive, merge, approval or process cleanup.
- Replacing Herdr's process, pane, terminal or PTY ownership.
