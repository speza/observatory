# Conversation-first Agent tracking

Status: accepted and implemented

Updated: 2026-09-02

This is the canonical conversation identity and recovery model. It replaces the
earlier admission, Session import and host-first reconciliation model and owns
the identity rules used by [Agent launch and workspace preparation](session-launch.md).

## Decision summary

Observatory tracks only explicitly admitted provider conversations as Agents. A
conversation enters the durable Universe when the operator adds it from
Conversation history or when an Observatory-managed new launch proves its exact
conversation identity. Merely appearing in a provider catalogue or host
snapshot never creates an Agent.

Herdr does not define the Agent. It reports whether and where an admitted
conversation currently has an execution that Observatory can inspect, attach
to or close.

```text
System
└── Goal
    └── Agent = one admitted durable provider conversation
        ├── human metadata and assignment
        ├── provider metadata and continuity
        └── execution binding = current runtime location, when proven
```

Conversation history is the discovery and admission surface for work started
outside Observatory. Untracked live executions remain bounded diagnostics until
the operator explicitly admits their conversation.

## Why

Automatic discovery made external provider and host observations an implicit
write authority over the durable Universe. A background catalogue scan could
create an Agent and put it in Inbox without a user decision, while a host
snapshot could turn unrelated local activity into managed work.

The product instead answers two separate questions:

1. Which durable provider conversations has the operator chosen to supervise?
2. Where, if anywhere, is each admitted conversation running now?

Admission is explicit. After admission, conversation identity is durable and
execution presence is replaceable and may be unknown. A failure to observe
Herdr must never damage, duplicate or stale the conversation identity.

## Goals

- Admit Agents only through an explicit user action or an
  Observatory-managed new launch.
- Preserve one admitted Agent identity across process exit, Herdr restart,
  Observatory restart and exact resume into a new execution.
- Detect current Herdr execution presence independently from provider
  continuity.
- Keep Goal assignment, human name, archive and admission under human control.
- Preserve uncertainty without exposing internal reconciliation axes as the
  primary user experience.
- Keep external conversations discoverable in Conversation history without
  flooding Atlas or Inbox.
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

A searchable catalogue of provider conversations that are not part of the
active Observatory. It replaces Session import as a recovery-heavy workflow.
Selecting an entry performs `Add to Observatory`; this explicit admission is
required for any conversation started outside Observatory, regardless of
recency or current execution presence.

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

Observatory maintains an active Universe and a supporting conversation index.
Only two operations may create a durable Agent:

1. the operator selects a catalogue entry in Conversation history and chooses
   `Add to Observatory` or `Add and assign to Goal`; or
2. an Observatory-managed **new** launch returns or later proves the exact
   conversation reference it created.

The admission command carries that provenance explicitly. Provider-catalogue
admission requires a scoped reference and carries the provider's actual resume
eligibility rather than assuming it is resumable. It may establish provider
title and continuity freshness. Managed-launch admission may begin
with an unscoped host reference; it preserves provider uncertainty and treats
the host display name as fallback evidence until provider evidence arrives.

An exact resume never creates an Agent: the target conversation must already be
admitted. Host observations, provider catalogues and provider-native activity
observations never admit Agents, regardless of liveness or recency.

Internal provider sessions, subagents, review threads, compaction sessions and
other non-user-resumable records are excluded by the harness adapter before
they reach Conversation history.

Provider catalogues populate and refresh Conversation history on startup or
explicit refresh. They do not need an admission baseline because newly
discovered and historical entries have the same status: discoverable but not
managed. Adding an entry is the only import-like action, and the UI calls it
Conversation history rather than Session import.

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

- canonical conversation indexing and admitted-reference resolution;
- explicit admission lookup;
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
- A scoped provider reference may resolve to one compatible unscoped
  managed-launch Agent only when no conflicting scoped identity exists.
  Provider catalogue evidence then enriches that Agent in place rather than
  creating a duplicate.
- If no Agent exists for the exact conversation key, retain the execution as
  untracked diagnostic evidence and do not create or promote an Agent.
- If the conversation exists only in history, liveness does not change its
  admission status; the operator must add it explicitly.
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

### Start directly in Herdr or another client

```text
User starts Codex/Claude outside Observatory
  -> provider catalogue may add it to Conversation history
  -> Herdr may report an exact live execution
  -> no durable Agent is created
  -> operator chooses Add to Observatory
  -> the admitted Agent binds to the exact current execution, if still proven
```

Provider activity alone does not prove that the process remains live. A host
observation alone does not make external work part of the managed Universe.

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
load Agents, observations and launch operations
  -> mark runtime evidence unknown until refreshed
  -> refresh provider catalogues and hosts independently
  -> deterministically reconstruct the same Agent bindings
```

Restart rebinds already admitted Agents only. Newly discovered external
conversations remain in Conversation history until explicitly added.

### Database reset

A full semantic reset loses Observatory-owned Goal assignment, human names,
relationships and layout. Provider catalogue and host refreshes after reset do
not reconstruct Agents. Conversation history can be repopulated, but each
conversation must be explicitly added again; no Goal or human metadata is
inferred from provider or host facts.

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

Inbox contains admitted active Agents without a Goal. Typical entries are
conversations explicitly added without assignment or Observatory-launched work
whose requested Goal is no longer available.

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

The explicit-admission schema is a clean-break generation. Existing local
databases from the automatic-admission generation require an explicit reset.
After reset, provider catalogues repopulate Conversation history but neither
catalogue nor host observations recreate durable Agents.

## Deleted or collapsed

The implementation removes:

- `ProviderSessionRecovery` and its host-observation filtering;
- the Session import workflow and recovery endpoints;
- managed Agent creation from host identity alone;
- `possibly-running`, `stale-observation`, `unidentified-execution` and
  `continuity-lost` headline states;
- the command that attached provider identity to a host-created Agent; and
- separate provider recovery and host admission paths.

`ConversationTracker` owns exact alias canonicalisation and Conversation
history behind one interface. It submits provider observations for already
admitted Agents only. Production submits accepted host and provider observations
through `Universe.observe`; untracked identities remain diagnostic.

## Implementation record

The unified observation model, exact execution binding, launch receipts and
Conversation history remain implemented. The explicit-admission revision:

- removes provider catalogue baselines and post-baseline admission;
- prevents host and provider observations from creating Agents;
- admits successful Observatory-managed new launches before binding them;
- preserves admission provenance and provider uncertainty;
- keeps exact resume restricted to an existing Agent;
- resolves scoped provider enrichment against compatible admitted launches
  inside Universe;
- filters provider-native enrichment to admitted conversations; and
- stops periodic catalogue scans while retaining startup and explicit history
  refreshes.

## Acceptance scenarios

1. Start a named new conversation through Observatory. Exactly one assigned
   Agent appears after exact launch identity is proven.
2. Start an unnamed new conversation through Observatory. Exactly one Agent
   appears; provider title may replace only its fallback name.
3. Start Claude Code directly in Herdr. No Agent appears automatically; its
   exact execution remains diagnostic until the conversation is explicitly
   added.
4. Start Codex in a native terminal. It may appear in Conversation history but
   not Atlas or Inbox until explicitly added.
5. Add a currently live history entry. Exactly one Agent is created and the
   exact host execution binds regardless of provider-first or host-first order.
6. Observe an untracked exact execution in every observation order. No durable
   Agent is created.
7. Stop an admitted Herdr process. The Agent becomes Dormant and keeps its Goal,
   name and conversation.
8. Disconnect Herdr. The Agent becomes Runtime unknown, never stale or dormant.
9. Restart Observatory while an admitted process continues. The same Agent
   rebinds without another admission action.
10. Resume into a new pane. The existing Agent binds the new execution; resume
    cannot manufacture an Agent.
11. Report the same admitted conversation in two live executions. The Agent
    becomes Conflict and neither execution is silently preferred.
12. Discover 500 conversations. They stay in Conversation history and do not
    flood Inbox or Atlas, regardless of when they were created.
13. Reset the database while conversations are live. No Agent returns until the
    operator explicitly adds it or starts new work through Observatory.
14. Provider-native observations for untracked conversations do not enter the
    durable observation store or projections.

## Success measures

- Zero durable Agents created by provider catalogue, host snapshot or
  provider-native observation alone.
- Exactly one Agent for each explicitly added or Observatory-launched
  conversation.
- Zero duplicate Agents under observation-order permutations.
- Zero cases where Herdr loss changes durable conversation identity.
- Every displayed uncertainty names the missing authority: provider, host or
  launch acknowledgement.

## Implemented defaults

1. Conversation history retains the local provider catalogue and projects the
   50 most recent entries per harness.
2. Catalogues refresh at startup and on explicit Conversation history refresh;
   there is no steady-state catalogue scan.
3. Only `AddConversation` and a proven Observatory-managed new launch admit an
   Agent.
4. `Runtime unknown` is the single headline; host/provider details explain the
   missing authority in the inspector and attention copy.
5. There is no host-first compatibility window or `Needs identity` queue.
6. Archived Agents remain human-controlled and do not automatically unarchive;
   a live execution creates an explicit `archived-running` attention item.
