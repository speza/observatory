# Spawned Agent lineage

Status: phase 1 implemented (token-first); phase 2 not started
Updated: 2026-09-11

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Technical architecture](../design/technical-architecture.md)
- [Plugin architecture](../design/plugin-architecture.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Agent harness plugins](agent-harness-plugins.md)
- [Agent launch and workspace preparation](session-launch.md)

## Decision

A session spawned by another session may be linked to its spawner only through
an explicit declaration carried as namespaced Herdr pane or workspace metadata.
The declaration is evidence, not authority.

Declared spawns are linked pending imports. They become visible with parent
context and a suggested parent Goal, but require one explicit admission action.
Observatory-brokered spawning (phase 2) records the parent in the launch receipt
and may auto-admit because it is a proven Observatory-managed launch.

The same links make fan-out work visible: a parent and its direct children form
one supervised group, nested in navigation and rolled up in attention without
merging the individual decisions.

When no declaration exists — for example a direct raw-`herdr` spawn — nothing
is inferred and the session stays unlinked. A human may create or clear the
link explicitly, or the spawner may stamp the token later while the child
execution is still observed.

Phase 1 is token-first: it works with the existing raw-`herdr` spawn workflow
without an agent-facing Observatory API. The parent, or the skill driving the
spawn, stamps a token; the Herdr adapter translates it; the Universe links it
only when both sides resolve exactly.

## Why

Operators ask one session to create another session to solve part of a problem.
The child appears in Herdr, is discovered by Observatory, and can be admitted —
but with no record that it came from the parent. The operator reconstructs the
relationship from memory, labels and cwd, which is exactly the weak inference
the product model forbids.

### What Herdr can and cannot provide

Verified against the installed Herdr protocol 22 on 2026-09-11:

- `PaneInfo`, `WorkspaceInfo` and every `*.created` event expose no
  creator, parent, origin or provenance field. Events carry the created object,
  never the client that requested it.
- `pane_created`, `tab_created`, `workspace_created` and `worktree_created` are
  subscription events, not a durable parent graph.
- Panes and workspaces expose `tokens`, an arbitrary namespaced string map
  (property names `[A-Za-z0-9_-]{1,32}`, at most 32 entries on read), set with
  `herdr pane report-metadata --source <id> --token name=value` and the
  workspace equivalent. Tokens are visible in `herdr api snapshot`, which the
  existing adapter already polls. This was exercised live: a token was set,
  observed in the snapshot, and cleared.
- `pane split` accepts no token or label argument. `--env` sets process
  environment, which Herdr does not expose in snapshots.
- `pane process-info` cannot prove parentage: panes are created by the host
  server, not as children of the requesting pane's process.
- Workspace "nesting" is repository and worktree derived. `WorkspaceInfo.worktree`
  and `herdr worktree list` group the primary checkout and linked worktrees of
  one repository, and the UI can present that family together. `source_workspace_id`
  means the workspace whose focused pane supplies a `follow` cwd policy on
  `workspace create`, or the repository's primary checkout in a worktree
  listing. Neither identifies the client that requested a creation.
- The spawn shapes therefore offer only co-membership: a split pane or new tab
  shares the parent's workspace, a worktree workspace shares a repository, and
  an arbitrary new workspace shares nothing. Co-membership is not spawner
  identity.

Herdr can therefore **carry** a declaration, but it cannot **observe**
parentage. Everything below treats a token as a claim.

## Model

### Spawn declaration

The declared convention is one reserved token name:

```text
ao-spawned-by = <parent execution id>
```

The value is the parent's Herdr pane id as seen by the spawning session
(`$HERDR_PANE_ID`), or another bounded host execution id the adapter can
resolve. `ao-spawned-by` is a host execution reference, not an Observatory
Agent id: it stays opaque outside the Herdr adapter, and core never projects
it. If a future brokered launch needs request correlation it may add a second
reserved token, `ao-spawn-ref`, under the same rules.

For a spawn that creates a new workspace (the `autonomous` worktree flow), the
token may instead be stamped on the workspace. Precedence:

1. Pane token.
2. Workspace token when the pane has none.
3. If both exist and disagree, the declaration is a conflict: no link is
   established and the discovery shows unresolved lineage.

Tokens are read with no TTL. A short TTL would silently erase provenance, and
establishment is already durable once admitted.

### Durable link

```ts
interface AgentSpawnLink {
  readonly childAgentId: AgentId;
  readonly parentAgentId: AgentId;
  readonly source: "declared" | "managed-launch" | "human";
  /** When the spawning action was declared; absent for a manual link. */
  readonly declaredAt?: number;
  /** When Observatory established the exact link. */
  readonly establishedAt: number;
}
```

Rules:

- One parent per child.
- The first exact establishment is durable. Later conflicting declarations are
  retained as evidence and never silently rewrite it.
- A human may establish, replace or clear a link for any admitted Agent through
  explicit commands. Human action is authoritative and is never overwritten by
  a declaration or observation.
- The link survives archive of either side. It is provenance, not topology: it
  creates no System, Goal, Atlas node or attention subject of its own.
- An unresolved declaration may be retained on the child as an opaque parent
  execution binding so a late exact match can still establish the link. If it
  never resolves, the child shows an explicit unidentified-spawner state until
  a human clears it.

### Fan-out hierarchy

Spawn links form a forest: one parent per child, and a parent with several
direct children is a fan-out. This is the primary supervision lens for work
that was fanned out to N sessions: the operator needs one place to see the
group, its aggregate state and each child.

- Navigator and Ledger nest children under their parent, one level at a time,
  with a direct-child count and an attention roll-up. Priority and completion
  never roll up.
- The inspector shows the parent and the direct children with navigation.
- Admission groups pending children under the declaring parent and supports one
  explicit batch action: admit all to Inbox, or admit and assign to the parent
  Goal. Nothing is automatic.
- Needs you may compose one fan-out subject that reports how many children need
  judgment and expands to the individual decisions. Each child remains an
  independent judgment; grouping must not hide or merge them.
- Atlas hierarchy is phase 3 and evaluated separately; the base map stays
  Goal-centric.
- The link graph must stay acyclic. Manual linking rejects self and any parent
  that is a descendant of the child.

### Suggested Goal

When the parent resolves to an Agent with a `primaryGoalId` at declaration
time, the discovery carries that Goal as a **suggestion only**. Admission
defaults to Inbox; assigning the suggested Goal is a separate one-click human
command. No spawn path ever assigns Goal, priority, completion or archive
automatically. This applies equally to brokered launches in phase 2.

## Invariants

1. Lineage is established only from an explicit declaration that resolves to
   an exact Agent on both sides. Same execution container, workspace, worktree,
   repository, cwd, title, label or recency never establishes lineage. Those
   signals remain the existing Related-Agent evidence only.
2. A declaration is not authority. It cannot assign a Goal, change priority,
   complete or archive anything, or admit an Agent by itself.
3. Declared spawns require explicit admission. Only a proven
   Observatory-managed launch may auto-admit, per the existing launch
   invariants.
4. Unresolved, conflicting or stale declarations remain explicit unknowns. They
   are never converted into accepted lineage or a fabricated parent.
5. Host identifiers and raw token values never leave the Herdr adapter. Core
   stores resolved Agent ids or bounded opaque execution references.
6. A discovered execution with a declaration still cannot be renamed, assigned
   or switched into as a durable Agent before admission.
7. Losing Herdr metadata degrades lineage to unknown. It cannot corrupt Agents,
   Goals, assignments or accepted state.
8. Lineage adds no durable organisation node and no automatic attention item of
   its own. A fan-out subject may only aggregate attention the child Agents
   already have.

## Interfaces

### Host seam

```ts
/** A bounded, provenance-bearing claim that this execution was spawned. */
interface HostSpawnDeclaration {
  /** Opaque to core; only the owning host adapter may interpret it. */
  readonly parentNativeId: string;
  /** Bounded reporter channel label, for explanation only. */
  readonly source: "pane-token" | "workspace-token" | "launch-receipt";
  readonly declaredAt: number;
}

interface HostAgentObservation {
  // existing fields unchanged
  readonly spawnDeclaration?: HostSpawnDeclaration;
}
```

The Herdr adapter:

- reads `tokens["ao-spawned-by"]` from the pane and then the workspace;
- validates before translating: non-empty, bounded length (for example 128),
  no control characters, no path-like values; a failed read is dropped with a
  bounded diagnostic and never partially redacted;
- emits at most one declaration per observation; when the pane and workspace
  disagree it retains the pane value as a declaration flagged `conflict: true`
  with a bounded diagnostic, so the conflict stays visible instead of vanishing;
- never exposes the raw token value or the pane id to projections.

The mock host accepts `spawnDeclaration` in fixtures so deterministic
reconciliation tests do not depend on Herdr.

### Universe

Reconciliation resolves `spawnDeclaration.parentNativeId` against Agent
execution bindings (current, conflicting and historical) within the same
`hostKind` and `hostInstanceId`. Exactly one match resolves the parent; zero or
multiple matches stay unresolved and are visible as such.

Discovery records and `DiscoveredExecutionAccess` carry the resolved or
unresolved declaration for admission. `AddConversation` gains an optional
spawn clause so admission writes lineage through the one Universe command path:

```ts
interface SpawnAdmission {
  readonly source: "declared" | "managed-launch";
  readonly declaredAt: number;
  /** Resolved parent, or the opaque binding to keep looking for. */
  readonly parent:
    | { readonly kind: "resolved"; readonly parentAgentId: AgentId }
    | {
        readonly kind: "unresolved";
        readonly execution: {
          readonly hostKind: string;
          readonly hostInstanceId: string;
          readonly nativeId: string;
        };
      };
}
```

Validation: the parent must exist and differ from the child. A resolved
declaration is written once and cannot silently replace an existing link. A
durable unresolved binding is retained and later observations may establish the
link when an exact Agent appears. Manual links additionally reject any parent
that is a descendant of the child, so the link graph stays acyclic. Explicit
human commands may establish, replace or clear lineage:

```ts
| {
    readonly type: "SetAgentSpawnParent";
    readonly childAgentId: AgentId;
    readonly parentAgentId: AgentId;
  }
| { readonly type: "ClearAgentSpawnParent"; readonly childAgentId: AgentId }
```

A human-set link records source `human` and is authoritative: later
declarations or observations may report a conflict but never overwrite it.

Persistence adds one table, in line with the clean-break schema policy:

```sql
CREATE TABLE IF NOT EXISTS agent_spawn_links (
  child_agent_id TEXT PRIMARY KEY,
  parent_agent_id TEXT NOT NULL,
  source TEXT NOT NULL,
  declared_at INTEGER NOT NULL,
  established_at INTEGER NOT NULL,
  FOREIGN KEY(child_agent_id) REFERENCES agents(id),
  FOREIGN KEY(parent_agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS agent_spawn_declarations (
  child_agent_id TEXT PRIMARY KEY,
  host_kind TEXT NOT NULL,
  host_instance_id TEXT NOT NULL,
  native_id TEXT NOT NULL,
  source TEXT NOT NULL,
  declared_at INTEGER NOT NULL,
  FOREIGN KEY(child_agent_id) REFERENCES agents(id)
);
```

### Projection

```ts
interface SpawnLineageView {
  readonly state: "resolved" | "unresolved" | "conflict";
  readonly parentAgentId?: AgentId;
  readonly parentDisplayName?: string;
  readonly parentArchived?: boolean;
  readonly suggestedGoal?: { readonly goalId: GoalId; readonly title: string };
  readonly explanation: string;
}
```

`DiscoveredExecutionView` and `AgentView` gain `spawnedBy?: SpawnLineageView`.
The Agent inspector additionally lists direct children from `AgentSpawnLink`
(id, display name, archived flag). Counts and Ledger reuse the same projection.

### Web

Admission continues to take only the opaque discovery handle and an optional
Goal id. The server resolves the declaration, so no host identifier reaches the
browser. The UI shows the parent, the suggested Goal as a separate action, and
an explicit explanation for unresolved or conflicting lineage. Human set,
replace or clear parent actions send Observatory Agent ids only; the browser
never supplies a host identifier.

## Flows

### Raw-Herdr spawn (phase 1)

1. A parent session splits a pane or creates a worktree workspace and starts a
   child agent using the existing `herdr` workflow.
2. The spawning skill or parent stamps `ao-spawned-by=$HERDR_PANE_ID` on the
   child pane, or on the workspace when the pane will not carry it.
3. The normal host refresh observes the child with its declaration.
4. If the parent resolves exactly, the discovery shows resolved lineage and the
   suggested parent Goal. Otherwise it shows an explicit unresolved state.
5. The operator admits the child, optionally assigning the suggested Goal in
   the same action. Admission writes the durable link.

### Direct usage with no declaration

1. A session is spawned with raw `herdr` commands and no token.
2. Observatory shows an ordinary discovery with no lineage.
3. The operator either links it manually after admission, or the spawner stamps
   `ao-spawned-by` later while the child execution is still observed.
4. No similarity signal ever creates the link.

### Brokered spawn (phase 2)

1. A human, or an agent acting under an explicit spawn policy, submits a start
   intent carrying `parentAgentId`.
2. The coordinator records the parent in the durable launch receipt.
3. The child resolves through the existing managed-launch identity path and is
   admitted automatically because the launch is proven.
4. Lineage is written from the receipt, with the same one-parent, no-Goal-
   inheritance rules. Stamping the Herdr token is optional presentation, not a
   correctness requirement.

## Failure and uncertainty

| Situation                                      | Result                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token absent                                   | No declaration; existing discovery behaviour unchanged                                                                                                      |
| Direct spawn, no token                         | No link and no inference; a human can link manually, or the spawner can stamp later while the child execution is live                                       |
| Token present, parent not an Observatory Agent | Unresolved declaration retained while the child execution is observed; child admits without a link but keeps the unresolved state                           |
| Parent Agent archived                          | Link remains; UI marks the parent archived and still offers navigation                                                                                      |
| Pane and workspace tokens disagree             | Conflict; no link, explicit explanation, human clears or corrects                                                                                           |
| Token cleared before admission                 | Declaration disappears; no link is fabricated                                                                                                               |
| Token appears after admission                  | A late declaration may establish the link while the child's exact execution is still observed, or from a retained unresolved binding; never from similarity |
| Parent has multiple execution bindings         | Resolve only when exactly one Agent matches; otherwise unresolved                                                                                           |
| Herdr unavailable                              | Lineage becomes unknown; Agents, Goals and assignments are unaffected                                                                                       |

## Surfaces

| Surface             | Phase | Behaviour                                                                                                                                                      |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery/inspector | 1     | Parent label, suggestion, unresolved/conflict explanation; no raw host ids                                                                                     |
| Inbox/Ledger        | 1     | Fan-out nesting: children under parent, direct-child and attention counts, batch admission                                                                     |
| Inspector actions   | 1     | Human set, replace or clear a parent for admitted Agents                                                                                                       |
| Catch up            | 2     | "X started Y" transition once lineage establishment is a semantic change                                                                                       |
| Needs you           | 2     | Optional fan-out subject rolls up how many children need judgment, expanding to each independent decision                                                      |
| Atlas               | 1     | Children collapsed by default with a count/attention badge; selecting an Agent expands its subtree in a local fan with tethers. Nested subtree remains phase 3 |

Atlas work is deliberately last: adding edges for every relationship is the
generic-graph failure the product design warns about.

## Implementation phases

### Phase 1: token lineage and linked pending import

- Add `HostSpawnDeclaration` and Herdr token translation with validation and
  conflict detection.
- Resolve declarations in Universe reconciliation; add discovery lineage views.
- Add the `AddConversation` spawn clause and the human
  `SetAgentSpawnParent`/`ClearAgentSpawnParent` commands with an inspector
  action, persistence and clean-break schema.
- Project lineage in discovery, Inbox, Ledger and inspector, including
  fan-out nesting, direct-child and attention counts, and grouped admission.
- Ship a thin spawn helper (script or skill wrapper) that wraps the Herdr
  split/start commands and stamps `ao-spawned-by`, and update the `herdr` and
  `autonomous` skill guidance to use it, so the convention is executable
  rather than documented.

Gate: a disposable two-pane spawn appears with resolved lineage, admits to
Inbox, and offers the parent Goal; unresolved, conflict and cleared cases are
covered deterministically.

### Phase 2: brokered spawn and richer lenses

- Add `parentAgentId` to `StartAgentIntent` and the durable launch receipt.
- Record lineage at managed-launch admission.
- Add Catch-up transitions and the Needs-you fan-out roll-up.
- Only then evaluate an agent-facing spawn ingress (the Mothership direction)
  as an explicit authority decision.

Gate: a brokered child auto-admits with exact receipt lineage and no Goal
inheritance; no raw Herdr identifier reaches a projection.

### Phase 3 (evaluate): spatial expression

- A bounded spatial pass is implemented: declared children cluster in the
  nearest free satellite slots beside their parent, cards carry a child-count
  badge, and selecting an Agent draws tethers to its direct lineage while
  dimming unrelated cards.
- A nested parent-focused subtree or a stronger grouping treatment remains
  open; do not proceed without dogfooding evidence that orientation improves.

## Implementation record (2026-09-11)

Phase 1 first pass is implemented:

- `HostSpawnDeclaration` on host observations; the Herdr adapter reads
  `ao-spawned-by` from the pane then the workspace, validates bounded opaque
  values and drops conflicting declarations with a diagnostic.
- Universe resolution, `AddConversation` spawn clause, durable
  `agent_spawn_links` / `agent_spawn_declarations` persistence, late
  declaration resolution, and `SetAgentSpawnParent` / `ClearAgentSpawnParent`
  with self and cycle rejection.
- `SpawnLineageView` on Agent and discovered-execution projections with the
  suggested parent Goal; the agent inspector lists direct children and exposes
  a manual spawn-parent selector, and the discovery inspector shows declared or
  conflicting lineage plus a one-click add-to-parent-Goal action.
- Atlas keeps declared children collapsed by default: parent cards carry a
  direct-child badge that switches to the attention accent when a hidden child
  needs judgment. Selecting an Agent expands its declared subtree in a
  deterministic, collision-avoided local fan with tethers and dims unrelated
  cards. Unrelated satellite positions stay identity-derived.
- The system/goal navigator nests declared children under their parent with
  depth indentation, an expand/collapse toggle, a direct-child count and an
  attention roll-up, so the left panel mirrors the Atlas family structure.
- Declared links loaded with an unrecognised persisted source become `unknown`
  rather than being coerced into a named provenance.
- Deterministic coverage: adapter token precedence, conflict, validation and
  the conflict view, discovery lineage, admission link, unresolved-then-late
  resolution, manual commands and cycles (including re-admission), projection
  children, lineage-aware satellite clustering, persistence round-trip and the
  web command endpoint.

Not yet implemented:

- Continuous token ingestion for Agents already admitted before the token
  appears. Declarations are captured at discovery admission; a late token on an
  already-admitted execution is not re-read.
- Later conflicting declarations after an established link are dropped rather
  than retained as evidence, and a conflict does not survive admission as a
  visible explanation.
- Ledger fan-out nesting and grouped admission, the Needs-you fan-out
  roll-up, Catch-up transitions, a nested Atlas subtree and the spawn
  helper/skill adoption. The navigator already nests; the Ledger still
  renders a flat list.
- Live Herdr smoke with a real two-pane stamp; the token persistence-across-
  restart spike remains open.

## Verification

- Adapter tests: token present, absent, malformed, oversized, control
  characters, pane/workspace precedence, conflict, cleared metadata.
- Reconciliation tests: exact parent match, no match, ambiguous match, late
  resolution, conflicting re-declaration after establishment.
- Universe tests: admission with resolved and unresolved declarations, duplicate
  admission, parent equals child, self and descendant cycle rejection, manual
  set/replace/clear precedence over declarations, link survives archive.
- Projection and browser tests: lineage views, fan-out nesting and counts,
  grouped admission, suggestion action, unresolved and conflict explanations,
  no host ids or raw tokens in snapshots.
- Live smoke: two disposable Herdr panes, stamp, observe, admit, archive and
  confirm no orphaned processes.
- Spike before phase 1 closes: whether Herdr persists `tokens` across daemon
  restart and session restore. If tokens do not persist, live linkage still
  works and established links remain durable; the spec's unresolved-state
  behaviour must be re-checked against that finding.

## Privacy and security

- Token values are bounded and validated at the adapter; rejected values never
  reach persistence, logs or browser projections.
- Lineage displays Agent names, never pane, workspace, terminal or token
  values.
- No prompt, transcript, terminal output or environment content is read for
  lineage.
- The token is a local, human-visible declaration with no cryptographic
  authority; the UI explains lineage as declared.

## Rejected alternatives

- **Infer lineage from execution container, worktree or repository.** Those are
  similarity signals already covered by Related-Agent evidence; they do not
  identify a spawner.
- **Process ancestry via `pane process-info`.** Host-created panes are not
  children of the requesting process.
- **Parse titles, labels or `auto-<slug>` naming.** Convention is not evidence
  and would create false links.
- **Treat workspace or worktree nesting as lineage.** The grouping is
  repository derived: it cannot distinguish a spawned child from any other
  session in the same workspace or worktree family.
- **Store raw tokens or pane ids in projections.** Violates the host seam and
  the browser boundary.
- **Auto-admit or auto-assign declared spawns.** Admission and Goal assignment
  stay human-controlled for the token path.
- **Make lineage a topology node or generic relationship graph.** It is
  provenance attached to an Agent.
- **Require provider hooks now.** Hooks would still need a declared parent and
  are already deferred; the token channel is smaller and host-neutral in shape.
- **Use `report-metadata` as the only durable record.** Admission establishes
  durable lineage in SQLite; tokens only carry the declaration.

## Open decisions

1. Does Herdr persist `tokens` across daemon restart and session restore, and do
   they survive pane replacement? Phase 1 spike.
2. Which `--source` value should be reserved for the convention, and how should
   the adapter react when multiple sources define the same token name?
3. Retention and dismissal UX for an unresolved declaration that never
   resolves.
4. Exact bounded validation rules for `parentNativeId` values (length, charset)
   across future hosts.
5. Whether phase 2's agent-facing spawn ingress needs a per-parent spawn policy
   before any agent can request children.
6. Whether a manual link should also be offered at discovery admission time
   (parent chosen from existing Agents), or only after admission.
7. Whether to request native creation provenance from Herdr (the requesting
   pane or workspace recorded on `pane_created`/`workspace_created`, or a
   creation argument). If it appears, the adapter swaps the token for native
   evidence and everything above the host seam is unchanged.
