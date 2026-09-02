# Conversation-first Agent tracking

Status: accepted and implemented

Updated: 2026-09-02

This is the canonical conversation identity and recovery model. It replaces the
earlier admission, Session import and host-first reconciliation model and owns
the identity rules used by [Agent launch and workspace preparation](session-launch.md).

## Decision summary

Observatory tracks durable provider conversations as Agents. A Codex, Claude
Code, Pi or other supported provider conversation is the primary identity,
regardless of whether it was started by Observatory, directly in Herdr, in a
native terminal or by another compatible tool.

Herdr does not define the Agent. It reports whether and where that conversation
currently has an execution that Observatory can inspect, attach to or close.

```text
System
└── Goal
    └── Agent = one durable provider conversation
        ├── human metadata and assignment
        ├── provider metadata and continuity
        └── execution bindings* = current runtime locations
```

The common path has no Session import step. A new or currently running
conversation is tracked automatically and appears either on its assigned Goal
or in Inbox. An older dormant conversation remains searchable in Conversation
history until the operator chooses to bring it into the active Observatory.

## Why

The current implementation allows two inventories to compete:

- Herdr observations can create host-bound Agents before provider identity is
  available; and
- provider catalogue observations create separate recovery candidates that
  require import.

That creates operational questions the user should not have to answer:

- Is this an Observatory Agent, a provider session or a Herdr session?
- Does it need importing even though it is already running?
- Is a stale Agent actually stopped, or did its execution identity fail to
  correlate?
- Which duplicate preserves the Goal, name and conversation?

The product should instead answer two separate questions:

1. Which durable provider conversations am I supervising?
2. Where, if anywhere, is each conversation running now?

Conversation identity is durable. Execution presence is replaceable and may be
unknown. A failure to observe Herdr must never damage, duplicate or stale the
conversation identity.

## Goals

- Track every new or currently running supported provider conversation without
  requiring an import workflow.
- Preserve one Agent identity across process exit, Herdr restart, Observatory
  restart and exact resume into a new execution.
- Detect current Herdr execution presence independently from provider
  continuity.
- Keep Goal assignment, human name, archive and other semantic state under
  human control.
- Preserve uncertainty without exposing internal reconciliation axes as the
  primary user experience.
- Make direct native, direct Herdr and Observatory-launched conversations
  converge to the same Agent model.
- Keep historical provider catalogues useful without flooding the active
  universe.
- Concentrate matching, admission, launch completion and recovery in one deep
  module with one test surface.

## Non-goals

- Transcript ingestion or rendering.
- Treating a Herdr workspace, tab, pane or shell as a durable Agent.
- Inferring conversation identity from cwd, repository, title, process name or
  recency.
- Automatically assigning a Goal from repository or execution-container
  similarity.
- Automatically resuming dormant conversations.
- Promising cross-machine resume without provider and workspace evidence.
- Showing every historical provider conversation in Atlas or Inbox.
- Replacing Herdr's process, PTY or terminal ownership.

## Terminology

### Agent

The durable work object supervised by Observatory. For a managed harness, one
Agent corresponds to exactly one provider conversation.

`AgentId` remains an internal Observatory surrogate used by commands, history
and relationships. It is not an independent continuity identity. A managed
Agent must have a canonical `ConversationKey`.

### Conversation

A provider-owned durable session such as a Codex thread or Claude Code
conversation. Conversation identity is exact and scoped:

```text
ConversationKey
  harnessId
  continuityScopeId
  nativeConversationRef
```

The key is canonicalised inside the relevant harness adapter. Native values
remain sensitive and do not enter ordinary browser projections.

### Execution

A current process/runtime location reported by a `SessionHost`:

```text
ExecutionKey
  hostKind
  hostInstanceId
  nativeExecutionId
```

An execution may expose an exact `ConversationKey`. If it does, Observatory can
bind it deterministically. An execution without exact provider identity is an
unidentified execution, not a durable managed Agent.

### Launch operation

A durable record that coordinates the side effect of starting or resuming a
conversation. It exists to prevent duplicate launches and correlate delayed
provider identity. It is not an Agent and does not appear in Atlas. The UI may
show it temporarily as `Starting`.

### Conversation history

A searchable catalogue of older dormant provider conversations that are not
part of the active Observatory. It replaces Session import as a recovery-heavy
workflow. Selecting an entry performs `Add to Observatory`; this is an explicit
admission of historical work, not a prerequisite for tracking current work.

## Authorities

| Concern                                                         | Authority                       |
| --------------------------------------------------------------- | ------------------------------- |
| Conversation identity, metadata and resume semantics            | `AgentHarness` provider adapter |
| Current process, terminal, attachment and close capability      | `SessionHost` adapter           |
| Goal, human name, archive, relationships and accepted lifecycle | `Universe`                      |
| Launch idempotency and exact launch correlation                 | durable launch operation        |
| Repository and worktree facts                                   | workspace/repository modules    |

No authority may substitute for another:

- Herdr cannot create durable managed identity without a conversation key.
- A provider catalogue cannot claim that a process is live unless an execution
  source proves it.
- A cwd or title cannot join a conversation to an execution.
- An execution disappearing cannot delete or stale a conversation.
- Provider activity cannot complete, archive or assign a Goal.

## Durable model

```text
Agent
  id
  conversationKey             required for managed Agents
  conversationAliases[]       exact provider-declared aliases only
  goalId?
  displayName
  displayNameSource           human | provider | fallback
  description?
  lifecycle                   active | archived
  createdAt
  updatedAt

ConversationObservation
  conversationKey
  providerInstanceId
  homeSiteRef?
  title?
  workspaceRef?
  createdAt?
  lastActiveAt?
  resumeEligibility
  observedAt
  snapshotScope
  provenance

ExecutionObservation
  executionKey
  conversationKey?
  runtimeState
  workspaceRef?
  repository?
  branch?
  executionContainer?
  observedAt
  hostLocator

LaunchOperation
  requestId
  intent
  status                     prepared | launched | identified | failed | ambiguous
  executionKey?
  conversationKey?
  agentId?
  createdAt
  updatedAt
```

Execution observations and provider observations have independent freshness and
completeness scopes. Derived presentation state is computed from them; it is
not persisted as one overloaded Agent status.

## Core invariants

1. One canonical `ConversationKey` maps to at most one non-archived Agent.
2. A managed Agent cannot exist without a canonical conversation key.
3. A conversation can exist with zero executions.
4. An execution can temporarily exist without a conversation key, but it is
   not admitted as a managed Agent.
5. An exact conversation key is the only automatic join between an Agent and
   an execution.
6. Exact provider-declared aliases may canonicalise identity; matching UUID
   text across different continuity scopes may not.
7. Cwd, repository, worktree, title, timestamps and process kind are display or
   candidate evidence only.
8. Host absence affects execution presence only. It never archives, replaces or
   marks the Agent itself stale.
9. Provider absence affects conversation availability only when a complete,
   correctly scoped snapshot proves it.
10. Missing or unavailable evidence becomes `unknown`, never a stronger claim.
11. Human names, Goal assignment and archive survive all observation changes.
12. A provider or host observation never automatically completes a Goal.
13. A launch operation may remain ambiguous, but it may not manufacture an
    Agent or retry its process side effect without exact evidence.
14. Two exact live executions for one conversation are a conflict; Observatory
    preserves both and does not choose a primary terminal silently.

## Admission policy

Observatory maintains an active universe and a historical conversation index.
Admission is deterministic.

### Automatically admitted

A user-resumable provider conversation becomes an active Agent when any of the
following is true:

1. an exact live execution reports its conversation key;
2. the conversation is identified by an Observatory launch operation;
3. the provider reports that it was created or first became active after the
   provider instance's durable catalogue baseline; or
4. it was already an accepted Agent before the current observation.

Automatically admitted conversations with no Goal appear in Inbox. They do
not require confirmation or import.

Internal provider sessions, subagents, review threads, compaction sessions and
other non-user-resumable records are excluded by the harness adapter before
they reach this policy.

### Historical only

On first connection to a provider instance, older dormant conversations with
no exact live execution are indexed in Conversation history. They do not flood
Atlas or Inbox.

The provider instance stores a durable baseline so restart and pagination do
not make old conversations look new. A configurable retention limit may bound
the history index, but it must not alter already accepted Agents.

### Explicit historical admission

The operator can select an older conversation and choose:

- `Add to Observatory`;
- `Add and assign to Goal`; or
- `Resume`, which first adds the Agent and then starts an exact eligible
  execution.

This is the only remaining import-like action, and the UI calls it Conversation
history rather than Session import.

## Observation and reconciliation module

The current `ProviderSessionRecovery` filtering model is replaced. Provider,
host and launch observations must not independently create or hide Agents.

The `Universe` exposes one observation interface:

```text
observe(
  ProviderCatalogueSnapshot
  | HostExecutionSnapshot
  | LaunchOperationObservation
) -> ReconciliationResult
```

Inside `universe/`, one deep conversation reconciler owns:

- canonical conversation indexing;
- automatic admission policy;
- provider alias resolution;
- exact execution binding;
- execution absence and host-unavailable handling;
- provider absence and provider-unavailable handling;
- launch completion and delayed identity correlation;
- duplicate/conflict detection;
- preservation of human metadata; and
- deterministic change records.

The reconciler stores the latest scoped raw observations needed to recompute
truth. Callers do not order provider refresh before host refresh, filter one
snapshot through another module or invoke repair methods.

The external interface is deliberately small. Harness and host adapters remain
real seams because both have production and mock implementations. Matching
helpers, indexes and observation caches remain internal seams; they are not
exposed merely for tests.

### Reconciliation order independence

The same final facts must produce the same Universe state regardless of event
order:

```text
provider then host
host then provider
launch then host then provider
provider then launch then host
restart then full snapshots
```

This is a primary contract test. The current stale/duplicate class of bugs is
an ordering failure and must become impossible at the module interface.

### Exact binding rules

- If a host execution reports a canonical conversation key, bind it to the
  Agent for that key.
- If no Agent exists and the conversation is automatically admissible, create
  exactly one unassigned Agent and bind the execution.
- If the conversation exists only in history but now has an exact live
  execution, promote it automatically and bind it.
- If an accepted launch operation reports both execution and conversation,
  complete the operation and apply its requested Goal and human name.
- If an execution lacks conversation identity, retain it only in the transient
  unidentified-execution inventory.
- If identity arrives later on that same current execution, bind by the newly
  reported exact conversation key. Do not create a prior host-bound Agent that
  then needs merging.
- If two observations claim the same conversation in two executions, expose a
  conflict and disable implicit terminal selection and resume.

## User-facing state

The UI does not expose the full reconciliation matrix as the Agent's headline.
It derives a small vocabulary:

| State                      | Evidence                                                             | Meaning                                       |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| `Starting`                 | accepted launch has no exact conversation identity yet               | Process creation is pending or ambiguous      |
| `Running in Herdr`         | exact current Herdr execution                                        | Attach and runtime actions are available      |
| `Running elsewhere`        | exact execution from another supported host                          | The conversation is live on that host         |
| `Dormant`                  | conversation confirmed; complete host evidence confirms no execution | Conversation exists without a current process |
| `Runtime unknown`          | conversation confirmed; host evidence unavailable or incomplete      | Observatory cannot say whether it is running  |
| `Conflict`                 | more than one exact current execution                                | Human resolution is required                  |
| `Conversation unavailable` | complete provider evidence proves loss                               | History remains; exact resume is unavailable  |

`Stale` describes an individual observation in diagnostics. It is never the
headline state of a durable Agent.

An unidentified execution is shown separately as `Unidentified process in
Herdr`. It is not rendered as a Goal satellite and cannot silently inherit a
Goal.

## Naming

Agent display-name precedence is:

1. explicit human name;
2. provider conversation title;
3. bounded workspace/repository fallback; and
4. harness label plus a short Observatory identifier.

Host terminal titles and Herdr workspace labels describe executions. They never
overwrite an Agent's human or provider-derived name.

An unnamed Observatory launch initially shows its launch/workspace fallback.
When the provider supplies a meaningful conversation title, the title may
replace only a fallback name. It may not replace a human name.

## Primary flows

### Start through Observatory

```text
User -> StartAgent intent
     -> persist LaunchOperation
     -> prepare workspace
     -> harness plans new provider conversation
     -> SessionHost starts execution
     -> UI shows Starting
     -> exact ConversationKey arrives from provider/native integration
     -> observe Conversation + Execution
     -> create or resolve one Agent
     -> apply human name and Goal
     -> UI shows Running in Herdr
```

The launch returns `started` only after exact conversation identity is known.
Before that it returns `starting` or `ambiguous`; it does not create a managed
host-only Agent. A blank launch remains visible as a persisted `LaunchOperation`
with an immediately available host terminal. The terminal is addressed by the
launch request id; the browser never receives the host execution reference.
Once the first interaction causes the provider to create a conversation, the
operation is promoted to the exact Agent and its requested name and Goal are
applied.

### Start directly in Herdr

```text
User starts Codex/Claude in Herdr
  -> Herdr reports execution
  -> native integration or provider catalogue reports ConversationKey
  -> conversation is admitted automatically
  -> exact execution is bound
  -> unassigned Agent appears in Inbox
```

No Session import action is required.

### Start outside Herdr

```text
User starts a supported provider natively
  -> provider catalogue observes a new conversation after baseline
  -> conversation is admitted automatically
  -> no supported host execution is known
  -> unassigned Agent appears in Inbox as Runtime unknown
```

Provider activity alone does not prove that the process remains live.

### Execution exits

```text
complete host snapshot no longer contains execution
  -> remove current execution binding
  -> preserve Agent, Goal, name and conversation
  -> derive Dormant when absence is proven
```

### Herdr becomes unavailable

```text
host snapshot unavailable
  -> preserve last execution as unconfirmed history
  -> preserve Agent and conversation
  -> derive Runtime unknown
```

### Exact resume

```text
User chooses Resume
  -> verify provider and workspace eligibility
  -> refuse if an exact execution is already live or runtime is unknown
  -> persist resume LaunchOperation
  -> harness plans exact resume for ConversationKey
  -> SessionHost starts replacement execution
  -> require acknowledgement of the same ConversationKey
  -> bind new execution to existing Agent
```

No implicit continuation prompt is sent.

### Observatory restart

```text
load Agents, observations, baselines and launch operations
  -> mark runtime evidence unknown until refreshed
  -> refresh provider catalogues and hosts independently
  -> deterministically reconstruct the same Agent bindings
```

Restart does not expose an import workflow for already accepted or currently
running conversations.

### Database reset

A full semantic reset loses Observatory-owned Goal assignment, human names,
relationships and layout. After reset:

- exact currently running conversations are admitted automatically;
- conversations created after the new provider baseline are admitted
  automatically;
- older dormant conversations remain in Conversation history; and
- no Goal or human metadata is inferred from provider or host facts.

## Projections and interaction

### Atlas

Atlas renders active admitted Agents only. It never renders launch operations,
historical conversations, Herdr workspaces or unidentified executions as
durable nodes.

### Pending launches

Pending launches are a small global supporting surface above Atlas rather than
map nodes. Each item shows `Starting`, its requested name and an `Open terminal`
action. It survives an Observatory restart through the launch receipt and
disappears after exact promotion. Closing its terminal releases only the
Observatory controller; it does not stop the host execution or discard the
launch operation.

### Inbox

Inbox contains active, automatically admitted Agents without a Goal. Typical
entries are conversations started directly in Herdr or natively outside
Observatory.

### Conversation history

Conversation history is a supporting searchable lens for older dormant
provider conversations. It supports provider, workspace, recency and
availability filters. Its primary action is `Add to Observatory`; `Resume` is
available only when exact eligibility is proven.

### Inspector

The Agent inspector presents three clearly separated sections:

```text
Conversation
  provider, title, continuity availability, last provider activity

Runtime
  Running in Herdr | Dormant | Runtime unknown | Conflict
  host label, last runtime observation, attach/close/resume actions

Context
  Goal, repository, branch, worktree, human description
```

Operational identifiers remain bounded and available only in the explicit
local inspector. Transcript paths do not enter browser projections.

### Diagnostics

Unidentified executions and stale individual observations live in a diagnostic
or runtime-attention lens. They do not compete with durable Agents in Atlas or
Inbox.

## Closeout and archive

Archive remains a human semantic action on the Agent.

- `Close & archive` closes every selected exact live execution through its
  host, confirms absence, then archives the Agent.
- `Archive only` hides the Agent while leaving executions untouched.
- An archived conversation that becomes live again does not automatically
  unarchive. It appears as an explicit attention item.
- Closing a Herdr execution without archiving leaves a Dormant Agent.

## Persistence

The implemented persistence model separates accepted Agents from the provider
history catalogue:

```text
agents
provider_conversations
provider_conversation_aliases
provider_catalogue_baselines
launch_receipts
goals and semantic relationships
```

An Agent row contains its required canonical conversation identity and current
optional execution binding. Execution history and exact conflicts remain
bounded Agent evidence. `provider_conversations` is only the searchable
history catalogue; it has no parallel accepted/imported lifecycle.

The store remains private to `universe/` and persistence modules. Adapters and
renderers never write these tables.

## Database transition

The conversation-first schema deliberately has no compatibility migration from
the experimental host-first database. Reset the local database when adopting
this version. After reset:

- exact currently running conversations are admitted automatically;
- the first complete provider catalogue establishes the durable history
  baseline without flooding Inbox;
- conversations first observed after that baseline are admitted automatically;
- older dormant conversations remain in Conversation history; and
- old Goals, assignments and human names are not inferred or reconstructed.

## Deleted or collapsed

The implementation removes:

- `ProviderSessionRecovery` and its host-observation filtering;
- the Session import workflow and recovery endpoints;
- managed Agent creation from host identity alone;
- `possibly-running`, `stale-observation`, `unidentified-execution` and
  `continuity-lost` headline states;
- the command that attached provider identity to a host-created Agent; and
- separate provider recovery and host admission paths.

`ConversationTracker` now owns provider catalogue baselining, exact alias
canonicalisation, automatic admission and Conversation history behind one
interface. Production submits all accepted host and provider observations
through `Universe.observe`.

## Implementation record

### Phase 0 — ratify and fixture the model — complete

- Accept this specification and mark conflicting portions of the previous
  continuity, execution and launch specifications as superseded.
- Add sanitized scenario fixtures for all acceptance cases below.
- Delete `ProviderSessionRecovery` after the unified observation scenarios pass.

Gate: the team can explain any Agent using only conversation identity, semantic
state and optional execution bindings.

### Phase 1 — introduce the unified observation interface — complete

- Add typed provider, host and launch observation variants to `universe/`.
- Implement the pure internal conversation reconciler.
- Persist raw scoped observations and catalogue baselines.
- Prove order independence with the mock harness and mock host.

Gate: provider-first, host-first and restart replays produce byte-equivalent
semantic Agent state.

### Phase 2 — conversation-first admission — complete

- Require a conversation key for newly created managed Agents.
- Automatically admit exact live and post-baseline conversations.
- Route unassigned admitted Agents to Inbox.
- Keep old dormant conversations in Conversation history.

Gate: new conversations started through Observatory, Herdr or a native client
all produce one unassigned-or-assigned Agent without import.

### Phase 3 — execution bindings and launch completion — complete

- Bind host executions only by exact conversation key.
- Make launch operations resolve through the unified observation interface.
- Preserve `Starting` without creating a host-bound Agent.
- Implement exact resume and execution conflicts through the same path.

Gate: concurrent same-cwd launches cannot cross-bind, and loss/reappearance of
Herdr never duplicates or stales an Agent.

### Phase 4 — reset the experimental database — complete

- Do not ship compatibility code for host-first Agent records.
- Reset the local database once when adopting the conversation-first schema.
- Rebuild active Agents from exact current conversations and future catalogue
  observations.

Gate: a fresh database produces no host-only Agents and no exact conversation
has two active Agents.

### Phase 5 — simplify the product surface — complete

- Replace Session import with Conversation history.
- Replace stale/possibly-running headlines with the reduced runtime vocabulary.
- Separate Conversation, Runtime and Context in the inspector.
- Remove superseded recovery controls and explanatory copy.

Gate: normal dogfooding requires no understanding of provider catalogues,
imports, Herdr identity or reconciliation state.

## Acceptance scenarios

1. Start a named Codex conversation through Observatory. Exactly one assigned
   Agent appears with the human name and `Running in Herdr`.
2. Start an unnamed Codex conversation through Observatory. Exactly one Agent
   appears; provider title may replace only its fallback name.
3. Start Claude Code directly in Herdr. Once exact identity arrives, one
   unassigned Agent appears automatically in Inbox.
4. Start Codex in a native terminal outside Herdr. A new conversation appears
   automatically in Inbox with `Runtime unknown`.
5. Observe host execution before provider identity, then identity before the
   next host snapshot. No host-bound Agent or duplicate is created.
6. Repeat scenario 5 in every observation order. Final semantic state is
   identical.
7. Stop a Herdr process. The Agent becomes Dormant and keeps its Goal, name and
   conversation.
8. Disconnect Herdr. The Agent becomes Runtime unknown, never stale or dormant.
9. Restart Observatory while the process continues. The same Agent rebinds
   without import.
10. Restart Herdr and lose the process. The same Agent becomes Dormant and
    offers exact Resume when eligible.
11. Resume into a new pane. The same Agent binds the new execution and preserves
    semantic history.
12. Report the same conversation in two live executions. The Agent becomes
    Conflict and neither execution is silently preferred.
13. Run two conversations in the same cwd. Exact keys keep them separate.
14. Discover 500 old dormant conversations on first provider connection. They
    stay in Conversation history and do not flood Inbox or Atlas.
15. Create a new conversation after that baseline. It appears automatically.
16. Reset the database while `ao-fix-logo-colour` is exactly live. It returns
    as one unassigned live Agent without a stale host-only clone.
17. Observe an execution without exact conversation identity. It remains
    diagnostic evidence and does not appear in Atlas or Inbox.
18. Delete a disposable Observatory database. Exact live conversations return
    automatically; old dormant conversations remain history; Goals are not
    invented.

## Success measures

- Zero import actions for newly created or currently running supported
  conversations.
- Zero duplicate Agents under observation-order permutations.
- Zero cases where Herdr loss changes durable conversation identity.
- One obvious runtime headline per Agent.
- Every displayed uncertainty names the missing authority: provider, host or
  launch acknowledgement.
- An operator can identify the conversation, its Goal and whether it is running
  without knowing what an Observatory recovery candidate is.

## Implemented defaults

1. The first successful complete snapshot for a provider instance establishes
   its durable catalogue baseline.
2. Conversation history retains the local provider catalogue and projects the
   50 most recent entries per harness.
3. `Runtime unknown` is the single headline; host/provider details explain the
   missing authority in the inspector and attention copy.
4. There is no host-first compatibility window or `Needs identity` queue.
5. Archived Agents remain human-controlled and do not automatically unarchive;
   a live execution creates an explicit `archived-running` attention item.
