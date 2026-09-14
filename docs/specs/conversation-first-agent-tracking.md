# Conversation-first Agent tracking

Status: accepted and implemented, including automatic Herdr Agent synchronization

Updated: 2026-09-14

This is the canonical conversation identity and recovery model. It replaces the
earlier Session import and host-recovery models and owns
the identity rules used by [Agent launch and workspace preparation](session-launch.md).

## Decision summary

Observatory tracks provider conversations as Agents when either the operator
adds them from Conversation history, Observatory launches them, or a supported
host reports recognized exact conversation identity. A host-synchronized Agent
starts in Inbox with no inferred Goal, direct System placement or human metadata.
Merely appearing in a provider catalogue, or appearing as an unidentified or
ambiguous host process, never creates an Agent.

Herdr does not define the Agent's human semantics. It reports exact execution
identity and whether and where the conversation currently runs, which
Observatory can inspect, attach to or close. Recognized host identity may
synchronize an Inbox Agent; unidentified, ambiguous or explicitly untrusted
executions remain transient discovery.

```text
System
├── Goal
│   └── Agent = one admitted durable provider conversation
└── Agent = one admitted durable provider conversation without a Goal
    ├── human metadata and assignment
    ├── provider metadata and continuity
    └── execution binding = current runtime location, when proven
```

An Agent has at most one human placement: an active Goal, a direct System, or
Inbox. Direct System placement is explicit and human-controlled; host,
repository and workspace evidence never chooses it.

Conversation history remains the admission surface for provider conversations
with no current host execution. A live Herdr execution with recognized exact
identity synchronizes into an Inbox Agent. A live execution without safe exact
identity is additionally shown as a transient `Discovered in Herdr` item in
Atlas, Ledger, search and the inspector. It is not a Goal, System or Inbox
Agent until explicitly admitted.

## Why

The synchronization boundary is deliberately narrow. A host can create an
identity-only Inbox Agent only when its adapter reports a recognized exact
conversation reference; a bare process, cwd, title or ambiguous scope remains
discovery. This removes duplicate admission and close workflows without
granting Herdr authority over Goals, names, assignments, completion or archive.

The product instead answers two separate questions:

1. Which durable provider conversations has the operator chosen to supervise?
2. Where, if anywhere, is each admitted conversation running now?

Identity admission is evidence-driven. After admission, conversation identity
is durable and execution presence is replaceable and may be unknown. A failure
to observe Herdr must never damage, duplicate or stale the conversation
identity.

## Goals

- Admit Agents through an explicit user action, an Observatory-managed new
  launch, or a recognized exact host observation.
- Preserve one admitted Agent identity across process exit, Herdr restart,
  Observatory restart and exact resume into a new execution.
- Detect current Herdr execution presence independently from provider
  continuity.
- Keep Goal/System assignment, human name, archive and semantic admission under
  human control; host synchronization may create only an unassigned identity
  record.
- Preserve uncertainty without exposing internal reconciliation axes as the
  primary user experience.
- Keep dormant provider conversations discoverable in Conversation history and
  ambiguous or unidentified executions visible in Atlas without flooding Inbox.
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
unidentified execution, not a durable managed Agent. It may still be a
transient discovered execution in the current host inventory.

### Launch operation

A durable record that coordinates the side effect of starting or resuming a
conversation. It exists to prevent duplicate launches and correlate delayed
provider identity. It is not an Agent and does not appear in Atlas. The UI may
show it temporarily as `Starting`.

### Conversation history

A searchable catalogue of provider conversations that are not part of the
active Observatory. It replaces Session import as a recovery-heavy workflow.
Selecting an entry performs `Add to Observatory` for a conversation with no
current recognized host execution; the operator may place it in a Goal, directly
in a System, or leave it in Inbox. A recognized live host execution is already
synchronized into Observatory; explicit admission remains required for
untrusted or ambiguous discovery and for dormant catalogue entries.

### Discovered execution

A discovered execution is current `SessionHost` evidence that cannot be safely
synchronized into an Agent. It is scoped by host kind, host instance and
native execution identity, is laid out by the map projection in the labelled,
compact discovery dock below the occupied universe, and is shown separately
from durable Agents. A discovery may retain the host's workspace grouping
context for consistent related presentation, but grouping never admits,
assigns or merges it. A discovery handle is opaque and is resolved only at the
server-side host seam. Browser projections contain safe display metadata, never
host locators or native terminal targets.

Discovery is rebuilt from a fresh host snapshot after restart and does not write
an Agent, assignment or semantic catch-up entry. Partial, stale or unavailable
host evidence retains the item as `Runtime unknown`; only a fresh complete
snapshot can prove its absence. Exact scoped catalogue evidence enables an
explicit `Add to Observatory` or `Add and assign to Goal` for an exception.
Terminal access is independent of admission and is revalidated against the
current host target. A host execution becomes eligible for synchronization only
once it carries recognized native session identity; transient detections without
one, ambiguous identities and explicitly untrusted evidence remain discovery.

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

A host may also report a grouping context for related execution containers.
Herdr uses this for its Git worktree family: linked worktree workspaces share
their source repository workspace's grouping context, while plain duplicate
workspaces remain separate. Observatory uses that relationship only for
workspace-first presentation and related evidence; it does not create a
repository hierarchy, merge execution identities or infer multi-repository
Agent semantics from it.

## Core invariants

1. One canonical `ConversationKey` maps to at most one non-archived Agent.
2. A managed Agent cannot exist without a canonical conversation key.
3. A conversation can exist with zero executions.
4. An execution can temporarily exist without a conversation key, but it is
   not admitted as a managed Agent; it may be visible as transient discovery.
   A recognized exact conversation key may synchronize an identity-only Agent
   without assigning a Goal or direct System.
5. An exact conversation key is the only automatic join between an Agent and
   an execution.
6. Exact provider-declared aliases may canonicalise identity; matching UUID
   text across different continuity scopes may not.
7. Cwd, repository, worktree, title, timestamps and process kind are display or
   candidate evidence only.
8. Host absence affects execution presence only. It never archives, replaces or
   deletes the Agent. Confirmed absence removes the Agent from active Atlas and
   Inbox projections while durable history remains available.
9. Provider absence affects conversation availability only when a complete,
   correctly scoped snapshot proves it.
10. Missing or unavailable evidence becomes `unknown`, never a stronger claim.
11. Human names, Goal/System placement and archive survive all observation changes.
12. A provider or host observation never automatically completes a Goal.
13. A launch operation may remain ambiguous, but it may not manufacture an
    Agent or retry its process side effect without exact evidence.
14. Two exact live executions for one conversation are a conflict; Observatory
    preserves both and does not choose a primary terminal silently.

## Admission policy

Observatory maintains an active Universe and a supporting conversation index.
Three paths may create a durable Agent:

1. the operator selects a catalogue entry in Conversation history and chooses
   `Add to Observatory` or `Add and assign to Goal`;
2. an Observatory-managed **new** launch returns or later proves the exact
   conversation reference it created; or
3. a supported host reports recognized exact conversation identity.

The host-synchronization command carries `host-observation` provenance and
creates an unassigned Inbox Agent with fallback naming and unknown provider
continuity until catalogue evidence arrives. It never assigns a Goal or System,
copies a workspace into semantic ownership or claims resume eligibility. A scoped host
reference is accepted directly. An unscoped reference is synchronized only if
the supporting catalogue does not contain conflicting provider scopes; an
ambiguous value remains discovery.

Provider-catalogue admission requires a scoped reference and carries the
provider's actual resume eligibility rather than assuming it is resumable. An
exact resume never creates an Agent: the target conversation must already be
admitted. Provider catalogues alone and provider-native activity observations
never admit Agents. Unidentified, ambiguous or explicitly untrusted host
executions remain visible through the separate discovery surface and require
explicit admission when exact catalogue evidence is available.

Internal provider sessions, subagents, review threads, compaction sessions and
other non-user-resumable records are excluded by the harness adapter before
they reach Conversation history.

Provider catalogues populate and refresh Conversation history on startup or
explicit refresh. They do not need an admission baseline because newly
discovered and historical entries have the same status: discoverable but not
managed. Adding an entry is the only import-like action, and the UI calls it
Conversation history rather than Session import.

## Observation and reconciliation module

The current `ProviderSessionRecovery` filtering model is replaced. Provider and
host observations are still typed evidence, but the conversation tracker may
submit a narrow identity-only host admission when exact evidence is recognized.
Neither provider nor host observations can assign, rename, complete or archive
an Agent.

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
- If no Agent exists for the exact conversation key and the host evidence is
  recognized, create an unassigned identity-only Agent and bind the execution.
- If the conversation exists only in history and has no current recognized host
  execution, the operator must add it explicitly.
- If the host identity is untrusted, unidentified or ambiguous, retain the
  execution as a transient `Discovered in Herdr` item.
- If an accepted launch operation reports both execution and conversation,
  complete the operation and apply its requested Goal and human name.
- If an execution lacks conversation identity, retain it in the transient
  `Discovered in Herdr` inventory with `Conversation not identified`.
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

An explicitly admitted conversation with confirmed provider identity and no
bound execution may still expose an explicit Resume action while its headline
remains `Runtime unknown`. Resume re-checks the current host snapshot and fails
closed if an ambiguous live execution could already own the conversation.

An unidentified execution is shown separately as `Discovered in Herdr`. It is
not rendered as a Goal satellite, Inbox Agent or semantic history entry, and
cannot silently inherit a Goal.

A confirmed-absent Agent remains available to the durable inspector and search
surfaces, but leaves the active Atlas and Inbox projections.

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
replace a fallback or earlier provider name. Subsequent provider title changes
continue to update the same Agent. Empty titles retain the existing name, and
provider titles may not replace a human name.

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
  -> recognized exact identity synchronizes an Inbox Agent
  -> ambiguous or unidentified identity remains Discovered in Herdr
  -> the Agent binds to the exact current execution, if still proven
```

Provider activity alone does not prove that the process remains live. A host
observation with only cwd, title, process kind or ambiguous identity does not
make external work part of the managed Universe.

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
  -> deterministically reconstruct the same Agent bindings and synchronize new
     recognized exact host conversations into Inbox
```

Restart rebinds already admitted Agents. Newly observed external executions with
recognized exact identity are synchronized from the next fresh host snapshot;
ambiguous or unidentified executions are reconstructed as discovery, while
provider conversations with no current execution remain in Conversation history.

### Database reset

A full semantic reset loses Observatory-owned Goal/System placement, human
names, relationships and layout. Provider catalogue refreshes after reset
repopulate Conversation history only; the next host refresh may recreate
identity-only Inbox Agents for recognized exact live conversations. No Goal,
System or human metadata is inferred from provider or host facts.

## Projections and interaction

### Atlas

Atlas renders active synchronized or explicitly admitted Agents and a clearly
separate `Discovered in Herdr` area for current host-reported executions that
could not be synchronized safely. Discovery items are not Goal satellites or
durable nodes; launch operations and historical conversations do not appear on
the map. Confirmed-absent execution records leave the active map but remain
durable and searchable.

### Pending launches

Pending launches are a small global supporting surface above Atlas rather than
map nodes. Each item shows `Starting`, its requested name and an `Open terminal`
action. It survives an Observatory restart through the launch receipt and
disappears after exact promotion. Closing its terminal releases only the
Observatory controller; it does not stop the host execution or discard the
launch operation.

### Inbox

Inbox contains active Agents without a Goal or direct System placement.
Recognized exact Herdr sessions arrive here automatically; dormant catalogue
entries and ambiguous discoveries do not. Confirmed-absent Agents leave the
active Inbox without being deleted or archived.

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

### Discovery and diagnostics

Unidentified, ambiguous and explicitly untrusted executions live in the normal
`Discovered in Herdr` Atlas and Ledger sections, with search and inspector
access. Stale, partial and unavailable host evidence remains visible there as
`Runtime unknown`; malformed or otherwise untrusted input may still be reported
as diagnostics. Recognized executions enter the Agent projection instead.
Discovery does not enter Inbox's Agent count or semantic history.

## Closeout and archive

Archive remains a human semantic action on the Agent.

- `Close & archive` closes every selected exact live execution through its
  host, confirms absence, then archives the Agent.
- `Archive only` hides the Agent while leaving executions untouched.
- An archived conversation that becomes live again does not automatically
  unarchive. It appears as an explicit attention item.
- Closing a Herdr execution without archiving leaves a durable confirmed-absent
  Agent outside the active Atlas and Inbox projections. No second close action
  is required after the external Herdr close is observed.

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

The current schema already stores the identity and execution evidence needed by
host synchronization. No separate Herdr workspace or process records are
introduced. Existing durable Agents continue to reconcile normally; newly
recognized host conversations are added through the existing Agent table and
remain subject to the same archive and history rules.

## Deleted or collapsed

The implementation removes:

- `ProviderSessionRecovery` and its host-observation filtering;
- the Session import workflow and recovery endpoints;
- `possibly-running`, `stale-observation`, `unidentified-execution` and
  `continuity-lost` headline states;
- the command that attached provider identity to a host-created Agent; and
- separate provider recovery and host admission paths.

`ConversationTracker` owns exact alias canonicalisation, Conversation history
and the narrow host-first synchronization policy behind one interface. It
submits recognized host identity through the existing `AddConversation` command
and provider observations through `Universe.observe`; untrusted or ambiguous
executions remain transient discovery items, while provider-native activity
remains admitted-only.

## Implementation record

The unified observation model, exact execution binding, launch receipts and
Conversation history remain implemented. The host-first revision:

- removes provider catalogue baselines and post-baseline catalogue admission;
- synchronizes recognized exact host observations into identity-only Inbox
  Agents;
- keeps untrusted, unidentified and ambiguous host observations in discovery;
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
   appears; provider titles replace its fallback and follow later provider renames,
   while an explicit human name remains protected.
3. Start Claude Code directly in Herdr with recognized exact identity. One
   Inbox Agent appears automatically and binds to the current execution.
4. Start Codex in a native terminal without recognized exact identity. It may
   appear in Conversation history and, when Herdr reports it, in the separate
   discovery area until explicitly added.
5. Add a currently live history entry. Exactly one Agent is created and the
   exact host execution binds regardless of provider-first or host-first order.
6. Observe an untrusted, unidentified or ambiguous execution in every
   observation order. It remains visible as discovery and no durable Agent is
   created.
7. Stop a synchronized Herdr process. Its durable Agent remains in state, but
   confirmed absence removes it from the active Atlas and keeps its name and
   conversation in history.
8. Disconnect Herdr. The Agent becomes Runtime unknown, never stale or dormant.
9. Restart Observatory while an admitted process continues. The same Agent
   rebinds without another admission action.
10. Resume into a new pane. The existing Agent binds the new execution; resume
    cannot manufacture an Agent.
11. Report the same admitted conversation in two live executions. The Agent
    becomes Conflict and neither execution is silently preferred.
12. Keep 500 dormant catalogue entries in Conversation history while two live
    recognized host executions are reported. The two current executions become
    Inbox or Goal Agents; only ambiguous or unidentified executions appear in
    discovery, and dormant history does not flood Inbox or Atlas.
13. Reset the database while conversations are live. Recognized exact host
    observations recreate identity-only Inbox Agents; no Goal or human metadata
    is reconstructed.
14. Provider-native observations for untracked conversations do not enter the
    durable observation store or projections.

## Success measures

- Zero durable Agents created by provider catalogue or provider-native
  observation alone.
- Exactly one Agent for each explicitly added, Observatory-launched or
  recognized exact host conversation.
- Zero duplicate Agents under observation-order permutations.
- Zero cases where Herdr loss changes durable conversation identity.
- Every displayed uncertainty names the missing authority: provider, host or
  launch acknowledgement.

## Implemented defaults

1. Conversation history retains the local provider catalogue and projects the
   50 most recent entries per harness.
2. Catalogues refresh at startup and on explicit Conversation history refresh;
   there is no steady-state catalogue scan.
3. Only `AddConversation` admits an Agent; its provenance distinguishes
   provider-catalogue, managed-launch and host-observation admission.
4. `Runtime unknown` is the single headline; host/provider details explain the
   missing authority in the inspector and attention copy.
5. There is no host-first compatibility window or `Needs identity` queue.
6. Archived Agents remain human-controlled and do not automatically unarchive;
   a live execution creates an explicit `archived-running` attention item.
7. Confirmed host absence removes an Agent from active map projections without
   deleting its durable identity or automatically archiving it.
