# V0 live Herdr universe/map

Status: implemented; live spatial and embedded-terminal smoke verified
Date: 2026-08-22  
Depends on:

- [Product design](../design/agent-orchestration-map.md)
- [Technical architecture](../design/technical-architecture.md)
- [Technology decisions](../design/technology-decisions.md)
- [Agent and linked execution model](agent-execution-model.md)
- [Contextual linked execution surfaces](contextual-companion-surfaces.md)

## Objective

Build the first real version of Observatory that can demonstrate whether organising live
agents around goals, attention and stable spatial memory is materially
better than Herdr's flat agent sidebar. The portable native spatial universe
is the primary V0 surface; flat attention/grouped views are supporting lenses.

The slice is successful only if it reduces the operator's catch-up problem: the
user can understand what the active work is doing, see what changed while they
were away, identify the result that matters, find where judgment is needed, and
make a more trustworthy completion decision.

The slice begins with existing recognized Herdr agents and ends with
the user attached to the correct real agent. It persists accepted AO metadata
across restarts. It is not another renderer prototype.

## Why this is next

The accepted OpenTUI experiments answered the renderer seam, not the product
hypothesis. They proved that a portable cell map can be navigable without
Kitty, Sixel or a custom raster engine. The largest remaining uncertainty is
whether the live spatial representation creates product value:

- Can the user understand what each agent is for without opening it?
- Can the user see which goal and agent need attention first?
- Can the user reach the right live agent quickly?
- Do stable goal locations and direct agent satellites improve orientation?
- Is maintaining goals and assignments less work than reconstructing context
  from agent names and transcripts?

Building more rendering infrastructure would not answer those questions. A live
walking slice will.

## Success definition

Using at least 15 real mixed active and idle Herdr agents, the user can:

1. identify every agent currently waiting for human input without opening
   agents individually;
2. explain the purpose and state of active goals in under two minutes;
3. jump to a named or attention-bearing agent, see its owning context, and
   open its embedded terminal in under ten seconds;
4. restart AO without losing accepted goals, priorities or assignments; and
5. use AO's spatial universe rather than opening Herdr's sidebar first for
   orientation during a one-week dogfood period; and
6. explain whether stable positions, semantic zoom and focused goal views reduce
   the effort of reconstructing work after time away.

The slice fails if goal maintenance feels administrative, attention cannot be
trusted, or the grouped Herdr sidebar remains faster for ordinary work.

## Included workflow

```text
start AO
  -> discover live recognized Herdr agents
  -> show unknown agents in the unassigned inbox
  -> create or select a goal
  -> assign agents directly to the goal
  -> rank goals with human-set priority
  -> surface explainable attention
  -> search or navigate to an agent
  -> inspect its execution metadata
  -> open the selected agent in an embedded Herdr terminal
  -> return to the same AO selection
  -> explicitly complete and later archive the goal
```

## Scope

### Included

- One local AO process.
- SQLite persistence through `bun:sqlite`.
- Herdr snapshot discovery with `snapshot.agents` as the agent inventory.
- Pane, tab and workspace metadata joined for agent inspection and opaque
  focus targets; shell-only panes are not tracked as AO agents.
- An unassigned-agent inbox.
- Goal create, rename, reprioritise, complete and archive actions.
- Human-confirmed archive of stale or unavailable agents.
- Direct agent-to-goal assignment and reassignment.
- Goal and agent search over AO names and descriptions.
- Explainable attention based on reliable host facts and human priority.
- A portable native OpenTUI spatial universe/map as the primary interface.
- A focused goal lens showing direct agent satellites.
- Supporting attention, grouped-list, search, inspector and inbox lenses.
- Deterministic goal placement with durable goal map positions.
- Agent inspector metadata.
- Host-owned embedded terminal with frame, input, resize and release.
- Host-observed N linked shells and sibling-agent executions, opened through a
  labelled picker without returning to Herdr.
- Shell-to-agent promotion through the next authoritative host snapshot.
- Restoration of AO selection after returning where the host permits it.

### Explicitly excluded

- A daemon or socket protocol.
- The local web observatory.
- Enhanced terminal graphics, Kitty/Sixel output or ANSI raster rendering.
- Worktree or repository nodes.
- Goal relationships or dependency graphs beyond direct Goal → Agent
  containment.
- Agent-created goals or assignments.
- Skills, hooks or provider-specific transcript parsing.
- Quick messages, structured approvals or broadcast input.
- Host stop controls.
- An AO-owned PTY or multiplexer.
- Automatic goal completion or archive.
- Native Git diff, overlap or integration analysis.

These are deferred, not forbidden. Each requires evidence from the live slice or
a second consumer that creates a real seam.

## Product model

V0 has only two durable user-facing objects:

```text
Goal 1 ── contains ──> 0..n tracked Agents
Agent ── assigned to ──> 0..1 Goal
```

An agent with no accepted goal appears in the unassigned inbox. Repository,
branch, worktree, provider, runtime and Herdr location are properties of a
agent. They never create navigation levels.

### Goal

```text
Goal {
  id
  title
  description?
  priority: P0 | P1 | P2 | P3
  status: active | completed | archived
  created_at
  updated_at
  completed_at?
  archived_at?
  map_position?: { x, y }
  map_position_pinned?: boolean
}
```

Rules:

- Title is required and editable.
- Priority is always human-set in v0.
- Only active goals appear in the default universe/map.
- Completing a goal dims it but does not hide it.
- Archiving hides it from the default view without deleting it.
- Completion and archive always require an explicit human action.
- A goal receives a deterministic world-space position when created. Moving or
  explicitly pinning a position is durable; viewport pan, zoom and active lens
  remain client-local state.

### Tracked agent

```text
Agent {
  id
  host_kind
  native_id
  display_name
  description?
  primary_goal_id?
  runtime_state
  runtime_state_source
  last_seen_at
  attention_since?
  repository?
  branch?
  worktree?
  provider?
  host_locator
  archived_at?
}
```

Rules:

- `(host_kind, native_id)` is the stable external identity.
- For Herdr, `native_id` is the recognized agent's hosting pane identity. The
  agent name is display metadata, not a durable AO identity.
- Rediscovery updates host facts without overwriting accepted AO names,
  descriptions, priorities or assignments.
- A vanished agent remains tracked and becomes stale; it is not silently
  deleted.
- A stale or unavailable agent may be explicitly archived by a human. It
  leaves active projections but retains its identity, assignment and history;
  rediscovery updates host facts without silently restoring it.
- Worktree data is inspectable metadata only.
- Unknown facts remain unknown rather than receiving inferred defaults.

## Attention in v0

Attention is a projection, not a mutable score stored on agents.

The first reliable attention reason is a Herdr agent state indicating that the
agent is blocked or waiting for input. The display must state the reason and how
long it has been true.

Ordering rules:

1. agents requiring human input before agents that do not;
2. parent goal priority `P0` through `P3`;
3. longest current wait first;
4. most recently changed host observation as the final tie-breaker.

Goal priority affects ordering but does not manufacture an attention state. A
P0 goal with a working agent remains important; it is not falsely labelled
blocked.

If Herdr is unavailable or the observation is stale, AO shows that uncertainty
and retains the last known organisation. It must not continue presenting an old
blocked state as current without its age.

Archived goals and their assigned agents are excluded from the default active
attention queue along with the archived goal's hidden map/list projection. An
explicit history query may still include their stored metadata.

The attention presentation and navigation contract is:

- a current attention agent has a steady `!` marker and increments its owning
  goal's `!N` badge;
- stale or uncertain state uses a distinct `?` marker and `?N` goal badge;
- the queue, focused view and inspector expose the reason and how long the
  condition has been present;
- a live agent that has just entered `done` remains gently review-visible for
  a short window: its `✓` marker and muted green treatment remain visible with
  a completion age, without becoming a new attention state;
- `g` cycles items in the ordering above, selects the agent and focuses its
  owning goal or inbox context; `f` can focus or reset that context manually;
- `t`, `Enter` or an agent double-click opens the selected agent in the
  host-owned terminal lens; and
- attention changes emphasis, counters and jump targets but never changes
  durable map positions or causes an automatic reflow.

Human-set `P0`–`P3` priority remains a stable visual treatment and ordering
input. Priority does not manufacture attention and must remain visually distinct
from transient `!`/`?` state.

## Terminal experience

The portable native spatial universe is the primary V0 surface. It is a
goal-centred portfolio map, not a flat agent list and not a graphical canvas
simulation. Goals are the largest durable bodies, direct agents are their
satellites, and repositories/worktrees remain agent metadata.

The default screen contains:

- a compact attention strip or queue whose items also surface their owning goal;
- a stable portfolio map of multiple goal bodies;
- direct agent satellites linked to their owning goal;
- an `INBOX !N · v list` warning for unassigned agents (never a Goal or
  Agent topology node); and
- a transient floating inspector card for the selected goal or agent.

Goal body size communicates agent load/scope. P0-P3 use a stable priority
colour/ring treatment. Blocked/waiting satellites use unmistakable `!`/`?`
markers, and their goal carries an attention badge even when the satellite is
outside the current viewport. Inspector and attention text preserve the wait
duration.

The interface must remain useful at 80x24. The map remains full width at every
size; inspection is a transient card anchored near the selected item rather
than a permanent right-hand panel. The card is clamped inside the map, uses
shorter copy when space is tight, and can be hidden with `i`. The portfolio
does not render unassigned agent cards; attention/focused inbox lenses expose
their compact list. A focused goal view is the fallback when the portfolio
contains more bodies or agents than the terminal can show at once.

The map supports deterministic free-space-aware initial placement, hierarchical
goal/agent navigation, keyboard pan, zoom, focus/reset, type-to-find
recentering, and OpenTUI mouse interaction where the terminal reports it.
Dragging a goal persists its world-space anchor and moves its direct satellite
orbit with it; dragging empty space or an agent card pans the viewport.
Clicking a goal or pressing focus enters a goal-only view containing exactly
that goal and all of its direct agents. Selecting an unassigned agent and
focusing it enters the supporting inbox list lens. New goals scan occupied goal
and satellite footprints for the next suitable logical position; accepted goals
do not reflow when unrelated goals or agents appear. Goal satellites use
stable collision-aware perimeter slots. The portfolio header warns about the
inbox count; attention/focused inbox lenses expose an attention-first list.
Creating a goal selects it automatically; `a` from a selected goal opens a
type-to-filter inbox assignment picker, while `a` from a selected agent opens
the goal picker. Clicking empty map space clears the selection and floating
inspector. The grouped list remains available as a supporting lens, never the
default.

V0 semantic zoom is separate from camera zoom. Camera zoom changes map scale;
semantic zoom changes label and metadata density without moving nodes:

- overview shows the portfolio, short labels, goal body size, priority,
  attention counts and direct tethers;
- context expands attention-bearing labels while retaining the owning goal or
  inbox-list context; the selected target receives the detail tier so its full
  title remains identifiable; and
- focus/detail keeps the complete direct orbit while following the selected
  label tier: dense focused goals may collapse healthy satellites to animated
  status markers in overview, context restores short labels, and detail shows
  larger or wrapped labels; the floating inspector exposes full agent
  metadata.

The attention jump is the fastest path to intervention: `g` selects and focuses
the next ordered attention item, `f` is the manual focus/reset action, and
`t`, `Enter` or an agent double-click opens the host-owned terminal lens.
Healthy or unrelated work may be dimmed by the attention lens, but its spatial
position remains stable. Focus/detail is the narrow-terminal fallback; the
portfolio must not compress every label until the map is unreadable.

Required operations are keyboard-complete:

- move focus between goals and agents;
- pan, zoom and focus the spatial map;
- jump to the next attention item;
- search;
- create, rename and reprioritise a goal;
- assign or reassign an agent;
- review observed related-agent candidates and batch-adopt or dismiss them;
- inspect metadata;
- open the selected agent in an embedded terminal;
- release the embedded terminal and return with map state;
- complete and archive a goal; and
- quit without terminal corruption.

The `g` → optional `f` → `Enter` attention path is the required V0 rapid-triage
contract; other key bindings are a renderer-level decision and may change during
dogfood. The current OpenTUI binding uses `A` for the supporting attention lens
and `z` to cycle overview, context and detail label density. Every destructive or hiding action must be labelled and confirmed when
its target is not already unmistakable.

## Module seams

V0 implements only the behaviour required by this workflow.

### Universe module

The Universe module owns accepted goals, tracked-agent identity, assignment
and lifecycle invariants.

```text
execute(Command) -> Result
project(Query)    -> Projection
reconcile(HostSnapshot) -> ReconciliationResult
```

Initial commands:

```text
CreateGoal
RenameGoal
SetGoalDescription
SetGoalPriority
AssignAgent
AdoptRelatedAgents
DismissRelatedAgents
UnassignAgent
RenameAgent
SetAgentDescription
ArchiveAgent
CompleteGoal
ArchiveGoal
```

The command surface does not expose SQL rows, Herdr pane IDs as universal types,
or OpenTUI events.

### Agent-host module

The Herdr adapter initially exercises only this subset of the wider host
interface:

```text
snapshot()                  -> HostSnapshot
access({ hostKind, nativeId }) -> AgentAccess
activate(AgentAccess)     -> HostActionResult
openTerminal(AgentAccess,
             TerminalDimensions) -> HostTerminalOpenResult
openLinkedExecutionTerminal(LinkedExecution,
                             TerminalDimensions) -> HostTerminalOpenResult
```

Herdr is a deliberate V0/V1 live-host requirement. This spec does not promise
tmux, Superlogical or an Observatory-owned multiplexer yet; it does require
that they can be added later as `SessionHost` adapters. Herdr protocol payloads,
CLI commands, native identifiers and pane topology remain inside
`hosts/herdr/` and the composition root. The Universe, persistence,
projections and renderer depend only on the generic contract above.

The adapter boundary is a hard acceptance rule: replacing the Herdr adapter at
composition time must not require changes to the semantic model, SQLite schema,
projection code or renderer. Add generic capability only after a real host or
user workflow demonstrates the need, and return an explicit unsupported result
otherwise.

`snapshot` discovers recognized Agents and their reliable runtime facts.
For Herdr, `snapshot.agents` is the authoritative agent inventory;
`snapshot.panes`, tabs and workspaces only enrich those observations with
topology, worktree and focus metadata. A pane without a recognized agent is not
an AO Agent. `access` returns an Agent-specific capability list plus opaque
foreground-handoff, primary-terminal and linked-execution targets. `openTerminal`
and `openLinkedExecutionTerminal` translate host-owned streams into frame,
input, resize and release operations. Each adapter-owned terminal target is
revalidated against a fresh Herdr snapshot before control begins; missing or
reused identities fail closed. AO does not reconstruct Herdr's
workspace, tab and pane hierarchy in its domain. `snapshot.agents` remains the
only source of durable Agent observations; linked shell panes are transient
until the host recognises them as Agents.

An adapter may also report an opaque execution-container reference on an
observation. Core modules may compare that exact reference as evidence for
related agents, but must not expose the host's container, workspace, tab or
pane as a durable Observatory object.

### Attention module

```text
evaluate(now, goals, agents) -> AttentionProjection
```

It is deterministic and receives a clock. It explains every promoted item with
a typed reason and timestamp.

### Projection module

```text
commandCentre(query) -> CommandCentreProjection
codeContexts(query)  -> CodeContextProjection
codeContextMap(query) -> CodeContextMapProjection
relatedAgents(query) -> RelatedAgentsProjection
search(query)        -> SearchProjection
inspector(target)    -> InspectorProjection
```

The TUI consumes these projections rather than database records or Herdr JSON.

The experimental `codeContexts` supporting lens groups agents by observed
repository, falling back to worktree or an explicitly labelled unknown context.
`codeContextMap` renders those same groups as derived map bodies with agent
satellites. Both keep agents as the selectable records and do not create
durable project nodes or alter direct Goal → Agent assignment. The
`relatedAgents` projection combines opaque execution-container matches,
worktree matches and repository matches into confidence-labelled evidence. It
returns candidates only; explicit `AdoptRelatedAgents` or
`DismissRelatedAgents` commands are required to change the Goal → Agent
state.

The primary projection is `universe-map`: a portfolio of goal bodies with
free-space-aware durable positions, size-by-agent-load, direct agent
satellites and attention summaries. The renderer's goal lens narrows that map to
one goal body and its direct satellites. `command-centre` remains the
supporting grouped-list lens. Neither projection creates repository, worktree or
relationship nodes.

### Persistence adapter

SQLite stores accepted domain state, durable goal map positions, explicit
related-agent dismissals and enough last-known host identity to reconcile
after restart. The fresh schema requires goals, Agents, hosts and
`related_agent_dismissals`; it intentionally does not migrate the earlier
session-shaped tables. Attention and rendered projections, including pan,
zoom and lens state, are recomputed or kept client-local rather than stored.

All domain commands that change multiple records execute atomically. Database
rows remain private to the adapter.

## Process shape

V0 runs in one process:

```text
OpenTUI client
      ↓ commands / projections
Universe + Attention + Projection
      ↓                 ↓
SQLite adapter      Herdr adapter
```

Dependencies are injected at composition time. The Universe module does not
import Bun, SQLite, OpenTUI or Herdr. A daemon is introduced only when a second
live client or agent process needs concurrent access.

## Reconciliation behaviour

On startup and manual refresh:

1. read accepted AO state from SQLite;
2. request a Herdr snapshot;
3. match agents by host kind and native identifier;
4. update observed runtime facts and last-seen timestamps;
5. add unknown live agents to the unassigned inbox;
6. mark previously tracked but missing agents stale; and
7. compute fresh universe-map, supporting command-centre and attention
   projections.

Reconciliation is idempotent. Retrying the same snapshot cannot duplicate a
agent or remove user-authored metadata.

## Terminal and return

AO asks the Herdr adapter for the selected agent's access capability. V0
opens a host-owned embedded terminal with `t`, `Enter` or an agent double-click
when the capability is available. The cell-native renderer forwards input and
resize and releases the controller with Ctrl-Q or Esc. Herdr owns the PTY; AO
does not own a durable process or multiplexer. Foreground attachment remains a
host capability for future fallback routes, but is not the primary V0 agent
interaction.

The TUI keeps the selected goal, selected agent, search query, expanded state,
map lens, focused goal, map centre and zoom while the embedded surface is open.
When control returns, it restores that state and refreshes the host snapshot.

If no embedded terminal is available, the inspector explains that limitation
instead of offering a dead action.

## Error behaviour

- **Herdr unavailable:** show the stored universe with a prominent stale-host
  state and permit metadata edits; disable live terminal entry.
- **Malformed host record:** skip only that observation, surface a diagnostic
  count and retain previous accepted state.
- **Incomplete host snapshot:** treat a missing required inventory array as an
  unavailable host snapshot; retain the previous accepted agent inventory.
- **Duplicate native identity:** reject ambiguous reconciliation and show a
  diagnostic; do not guess.
- **Agent disappears:** retain it as stale under its goal.
- **SQLite command failure:** roll back the entire command and leave the current
  projection unchanged.
- **Attach failure:** return to AO with the same selection and a visible error.
- **Terminal stream closes or fails:** keep the map state intact, show the
  reason in the terminal surface, and let the user release back to AO.
- **Terminal resize:** preserve semantic selection even if presentation changes.

## Verification

### Module tests

- Goal lifecycle and direct-assignment invariants through the Universe
  interface.
- Idempotent host reconciliation and stale-agent behaviour.
- Table-driven attention ordering with a controlled clock.
- Search across accepted goal and agent metadata.
- SQLite transaction rollback, restart persistence and migrations.
- Projection snapshots at wide and 80x24 layouts.
- Deterministic map positions, goal sizing, direct satellites, priority
  treatment and focused-map projection.
- Map viewport interaction tests for pan/zoom/search recentering and narrow
  focused fallback.
- Attention navigation tests for the exact ordering, reason/age presentation,
  owning-goal `!N`/`?N` aggregation, stable positions and the `g` then `Enter`
  terminal path.
- Semantic-zoom tests that expose more label/detail in context and focus views
  without reflowing durable map positions.
- Assignment-picker tests for inbox-first filtering and agent-to-goal
  assignment direction.
- Terminal-screen tests for split UTF-8, ANSI styling, cursor movement,
  alternate-screen state and bounded resize.

### Herdr adapter contract tests

- Parse a real sanitised snapshot.
- Use recognized agent records as agents and exclude pane-only terminals.
- Preserve opaque native identifiers.
- Report supported terminal capability accurately for the primary interaction;
  keep any foreground-attachment target opaque for future fallback routes.
- Open the host-owned terminal capability with opaque targets and dimensions;
  translate frames, input, resize, release and stream errors.
- Handle unavailable, empty and malformed responses.
- Never mutate Herdr during discovery.

### Manual acceptance

Using the current real Herdr environment:

1. start with no accepted AO goals;
2. discover every recognized agent and confirm the header shows the
   unassigned count warning (use at least 15 for the scale trial when the live
   environment provides them); press `v` to inspect the inbox list;
3. create three goals, including one P0 goal; confirm each new goal becomes
   selected and pressing `a` opens a type-to-filter inbox assignment picker;
4. assign and rename agents, then reassign one through the agent-to-goal
   picker;
5. restart and confirm persistence;
6. place one real agent into a waiting state;
7. confirm it is promoted with an explanation and duration;
8. press `g` repeatedly and verify the exact attention ordering, owning-goal
   badges and reason/age text; use `t` to open the selected agent's embedded
   terminal, send a harmless printable key, resize the terminal, and release
   with Ctrl-Q;
9. confirm the same selection, floating card, map lens, semantic detail tier
   and viewport return; use `Enter` again to exercise the direct terminal path;
10. search for another agent, confirm it is focused in spatial context, and
    open it with `Enter`;
11. return with the same selection and viewport as far as the host permits; and
12. stop or hide a test agent, select its stale agent from the list or
    attention lens, archive it with `x`, and confirm it leaves active
    projections while the record remains persisted; then complete a goal,
    confirm it remains dimmed, and archive it explicitly.

## Implementation order

1. Establish Bun project, stable quality commands and module folders.
2. Implement Universe records, commands and in-memory tests.
3. Implement SQLite persistence and restart tests.
4. Implement Herdr snapshot parsing and reconciliation tests.
5. Implement Attention, universe-map and supporting projections.
6. Build the portable native OpenTUI spatial universe over those projections.
7. Add map focus and full terminal return-state restoration.
8. Add the optional host-owned terminal stream, cell renderer and reversible
   terminal lens over the same selection state.
9. Run the manual acceptance flow and begin one-week dogfood.

Do not create the daemon, web client or agent skill while completing these
steps. A second consumer should create those seams from evidence rather than
anticipation.

## Dogfood evidence

Record:

- time to identify all waiting agents;
- time to find and open a named agent in the terminal;
- missed or falsely promoted attention items;
- number of agents opened merely to rediscover purpose;
- goal/assignment edits required per day;
- stale or duplicate reconciliation failures; and
- whether AO or Herdr's sidebar was used first for orientation.

At the end of one week, decide whether to continue into live-state hardening,
simplify the model further, or stop.
