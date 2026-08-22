# V0 live Herdr universe/map

Status: implemented; live spatial iteration smoke verified  
Date: 2026-08-22  
Depends on:

- [Product design](../design/agent-orchestration-map.md)
- [Technical architecture](../design/technical-architecture.md)
- [Technology decisions](../design/technology-decisions.md)

## Objective

Build the first real version of AO that can demonstrate whether organising live
agent sessions around goals, attention and stable spatial memory is materially
better than Herdr's flat session sidebar. The portable native spatial universe
is the primary V0 surface; flat attention/grouped views are supporting lenses.

The slice begins with existing recognized Herdr agent sessions and ends with
the user attached to the correct real session. It persists accepted AO metadata
across restarts. It is not another renderer prototype.

## Why this is next

The accepted OpenTUI experiments answered the renderer seam, not the product
hypothesis. They proved that a portable cell map can be navigable without
Kitty, Sixel or a custom raster engine. The largest remaining uncertainty is
whether the live spatial representation creates product value:

- Can the user understand what each session is for without opening it?
- Can the user see which goal and session need attention first?
- Can the user reach the right live session quickly?
- Do stable goal locations and direct session satellites improve orientation?
- Is maintaining goals and assignments less work than reconstructing context
  from session names and transcripts?

Building more rendering infrastructure would not answer those questions. A live
walking slice will.

## Success definition

Using at least 15 real mixed active and idle Herdr agent sessions, the user can:

1. identify every session currently waiting for human input without opening
   sessions individually;
2. explain the purpose and state of active goals in under two minutes;
3. jump to a named or attention-bearing session, see its owning context, and
   attach to the correct live session in under ten seconds;
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
  -> discover live recognized Herdr agent sessions
  -> show unknown sessions in the unassigned inbox
  -> create or select a goal
  -> assign sessions directly to the goal
  -> rank goals with human-set priority
  -> surface explainable attention
  -> search or navigate to a session
  -> inspect its execution metadata
  -> attach to the real Herdr session
  -> return to the same AO selection
  -> explicitly complete and later archive the goal
```

## Scope

### Included

- One local AO process.
- SQLite persistence through `bun:sqlite`.
- Herdr snapshot discovery with `snapshot.agents` as the session inventory.
- Pane, tab and workspace metadata joined for session inspection and opaque
  focus targets; shell-only panes are not tracked as AO sessions.
- An unassigned-session inbox.
- Goal create, rename, reprioritise, complete and archive actions.
- Direct session-to-goal assignment and reassignment.
- Goal and session search over AO names and descriptions.
- Explainable attention based on reliable host facts and human priority.
- A portable native OpenTUI spatial universe/map as the primary interface.
- A focused goal lens showing direct session satellites.
- Supporting attention, grouped-list, search, inspector and inbox lenses.
- Deterministic goal placement with durable goal map positions.
- Session inspector metadata.
- Focus or attachment to the real Herdr session.
- Restoration of AO selection after returning where the host permits it.

### Explicitly excluded

- A daemon or socket protocol.
- The local web observatory.
- Enhanced terminal graphics, Kitty/Sixel output or ANSI raster rendering.
- Worktree or repository nodes.
- Goal relationships or dependency graphs beyond direct Goal → Session
  containment.
- Agent-created goals or assignments.
- Skills, hooks or provider-specific transcript parsing.
- Quick messages, structured approvals or broadcast input.
- Session launch or stop controls.
- An AO-owned PTY or multiplexer.
- Automatic goal completion or archive.
- Git diff, overlap or integration analysis.

These are deferred, not forbidden. Each requires evidence from the live slice or
a second consumer that creates a real seam.

## Product model

V0 has only two durable user-facing objects:

```text
Goal 1 ── contains ──> 0..n tracked Sessions
Session ── assigned to ──> 0..1 Goal
```

A session with no accepted goal appears in the unassigned inbox. Repository,
branch, worktree, provider, runtime and Herdr location are properties of a
session. They never create navigation levels.

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

### Tracked session

```text
TrackedSession {
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
}
```

Rules:

- `(host_kind, native_id)` is the stable external identity.
- For Herdr, `native_id` is the recognized agent's hosting pane identity. The
  agent name is display metadata, not a durable AO identity.
- Rediscovery updates host facts without overwriting accepted AO names,
  descriptions, priorities or assignments.
- A vanished session remains tracked and becomes stale; it is not silently
  deleted.
- Worktree data is inspectable metadata only.
- Unknown facts remain unknown rather than receiving inferred defaults.

## Attention in v0

Attention is a projection, not a mutable score stored on sessions.

The first reliable attention reason is a Herdr session state indicating that the
agent is blocked or waiting for input. The display must state the reason and how
long it has been true.

Ordering rules:

1. sessions requiring human input before sessions that do not;
2. parent goal priority `P0` through `P3`;
3. longest current wait first;
4. most recently changed host observation as the final tie-breaker.

Goal priority affects ordering but does not manufacture an attention state. A
P0 goal with a working agent remains important; it is not falsely labelled
blocked.

If Herdr is unavailable or the observation is stale, AO shows that uncertainty
and retains the last known organisation. It must not continue presenting an old
blocked state as current without its age.

The attention presentation and navigation contract is:

- a current attention session has a steady `!` marker and increments its owning
  goal's `!N` badge;
- stale or uncertain state uses a distinct `?` marker and `?N` goal badge;
- the queue, focused view and inspector expose the reason and how long the
  condition has been present;
- `g` cycles items in the ordering above, selects the session and focuses its
  owning goal or inbox context; `f` can focus or reset that context manually;
- `Enter` attaches the selected session to the real Herdr session; and
- attention changes emphasis, counters and jump targets but never changes
  durable map positions or causes an automatic reflow.

Human-set `P0`–`P3` priority remains a stable visual treatment and ordering
input. Priority does not manufacture attention and must remain visually distinct
from transient `!`/`?` state.

## Terminal experience

The portable native spatial universe is the primary V0 surface. It is a
goal-centred portfolio map, not a flat session list and not a graphical canvas
simulation. Goals are the largest durable bodies, direct sessions are their
satellites, and repositories/worktrees remain session metadata.

The default screen contains:

- a compact attention strip or queue whose items also surface their owning goal;
- a stable portfolio map of multiple goal bodies;
- direct session satellites linked to their owning goal;
- a neutral unassigned inbox sector (a compact selectable inbox panel on narrow
  terminals, never a Goal or Session topology node); and
- a transient floating inspector card for the selected goal, session or inbox.

Goal body size communicates session load/scope. P0-P3 use a stable priority
colour/ring treatment. Blocked/waiting satellites use unmistakable `!`/`?`
markers, and their goal carries an attention badge even when the satellite is
outside the current viewport. Inspector and attention text preserve the wait
duration.

The interface must remain useful at 80x24. The map remains full width at every
size; inspection is a transient card anchored near the selected item rather
than a permanent right-hand panel. The card is clamped inside the map, uses
shorter copy when space is tight, and can be hidden with `i`. Narrow terminals
use a focused-goal or focused-inbox view and a compact selectable inbox sector
rather than cramming every body into the portfolio. A focused view is the
usable fallback when the portfolio contains more bodies or sessions than the
terminal can show at once.

The map supports deterministic free-space-aware initial placement, selected
goal/session navigation, keyboard pan, zoom, focus/reset, type-to-find
recentering, and OpenTUI mouse interaction where the terminal reports it.
Dragging a goal persists its world-space anchor and moves its direct satellite
orbit with it; dragging empty space or a session card pans the viewport.
Clicking a goal or pressing focus enters a goal-only view containing exactly
that goal and all of its direct sessions. Clicking the neutral inbox body or
compact inbox header enters an inbox-only view containing unassigned sessions;
focus on an unassigned session does the same. New goals scan occupied goal and
satellite footprints for the next suitable logical position; accepted goals do
not reflow when unrelated goals or sessions appear. Goal satellites use stable
collision-aware perimeter slots. Unassigned sessions orbit a neutral `INBOX`
body using the same identity-derived slot allocator; the orbit grows by rings
as it fills and has no fixed session limit. When the full map is shown, every
visible unassigned session has a direct muted cell tether from the inbox;
selected and attention-bearing tethers are promoted. The focused inbox view
keeps all of those tethers visible as the orbit expands. At 80x24 the portfolio
may use the compact inbox sector to keep goal bodies legible; entering the inbox
lens restores the spatial orbit. Label width adapts to the available cell
scale, so dense views shorten cards while focused/zoomed views expose more
identity. The inbox body and its tethers are a supporting presentation lens,
never a Goal or Session topology node. The grouped list remains available as a
supporting lens, never the default.

V0 semantic zoom is separate from camera zoom. Camera zoom changes map scale;
semantic zoom changes label and metadata density without moving nodes:

- overview shows the portfolio, short labels, goal body size, priority,
  attention counts and direct tethers;
- context expands the selected or attention-bearing labels while retaining the
  owning goal or inbox context; and
- focus/detail shows a focused goal or inbox with larger or wrapped labels and
  the complete direct orbit, while the floating inspector exposes full session
  metadata.

The attention jump is the fastest path to intervention: `g` selects and focuses
the next ordered attention item, `f` is the manual focus/reset action, and
`Enter` attaches. Healthy or unrelated work may be dimmed by the attention lens,
but its spatial position remains stable. Focus/detail is the narrow-terminal
fallback; the portfolio must not compress every label until the map is unreadable.

Required operations are keyboard-complete:

- move focus between goals and sessions;
- pan, zoom and focus the spatial map;
- jump to the next attention item;
- search;
- create, rename and reprioritise a goal;
- assign or reassign a session;
- inspect metadata;
- attach to the selected session;
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

The Universe module owns accepted goals, tracked-session identity, assignment
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
AssignSession
UnassignSession
RenameSession
SetSessionDescription
CompleteGoal
ArchiveGoal
```

The command surface does not expose SQL rows, Herdr pane IDs as universal types,
or OpenTUI events.

### Session-host module

The Herdr adapter initially exercises only this subset of the wider host
interface:

```text
snapshot()                  -> HostSnapshot
access(HostedSessionId)     -> SessionAccess
```

`snapshot` discovers recognized agent sessions and their reliable runtime facts.
For Herdr, `snapshot.agents` is the authoritative session inventory;
`snapshot.panes`, tabs and workspaces only enrich those observations with
topology, worktree and focus metadata. A pane without a recognized agent is not
an AO session. `access` returns an opaque focus or attachment target. AO does
not reconstruct Herdr's workspace, tab and pane hierarchy in its domain.

### Attention module

```text
evaluate(now, goals, sessions) -> AttentionProjection
```

It is deterministic and receives a clock. It explains every promoted item with
a typed reason and timestamp.

### Projection module

```text
commandCentre(query) -> CommandCentreProjection
search(query)        -> SearchProjection
inspector(target)    -> InspectorProjection
```

The TUI consumes these projections rather than database records or Herdr JSON.

The primary projection is `universe-map`: a portfolio of goal bodies with
free-space-aware durable positions, size-by-session-load, direct session
satellites and attention summaries. The renderer's goal lens narrows that map to
one goal body and its direct satellites. `command-centre` remains the
supporting grouped-list lens. Neither projection creates repository, worktree or
relationship nodes.

### Persistence adapter

SQLite stores accepted domain state, durable goal map positions and enough
last-known host identity to reconcile after restart. The schema requires goals,
tracked sessions, map-position migration and schema migrations. Attention and
rendered projections, including pan/zoom/lens state, are recomputed or kept
client-local rather than stored.

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
3. match sessions by host kind and native identifier;
4. update observed runtime facts and last-seen timestamps;
5. add unknown live sessions to the unassigned inbox;
6. mark previously tracked but missing sessions stale; and
7. compute fresh universe-map, supporting command-centre and attention
   projections.

Reconciliation is idempotent. Retrying the same snapshot cannot duplicate a
session or remove user-authored metadata.

## Attach and return

AO asks the Herdr adapter for the selected session's access capability. V0 uses
the strongest reliable existing focus or attachment route; it does not proxy a
PTY.

Before attachment, the TUI records its current selected goal, selected session,
search query, expanded state, map lens, focused goal, map centre and zoom. When
control returns, it restores that state and refreshes the host snapshot.

If no attachment route is available, the inspector explains that limitation
instead of offering a dead action.

## Error behaviour

- **Herdr unavailable:** show the stored universe with a prominent stale-host
  state and permit metadata edits; disable live attachment.
- **Malformed host record:** skip only that observation, surface a diagnostic
  count and retain previous accepted state.
- **Duplicate native identity:** reject ambiguous reconciliation and show a
  diagnostic; do not guess.
- **Session disappears:** retain it as stale under its goal.
- **SQLite command failure:** roll back the entire command and leave the current
  projection unchanged.
- **Attach failure:** return to AO with the same selection and a visible error.
- **Terminal resize:** preserve semantic selection even if presentation changes.

## Verification

### Module tests

- Goal lifecycle and direct-assignment invariants through the Universe
  interface.
- Idempotent host reconciliation and stale-session behaviour.
- Table-driven attention ordering with a controlled clock.
- Search across accepted goal and session metadata.
- SQLite transaction rollback, restart persistence and migrations.
- Projection snapshots at wide and 80x24 layouts.
- Deterministic map positions, goal sizing, direct satellites, priority
  treatment and focused-map projection.
- Map viewport interaction tests for pan/zoom/search recentering and narrow
  focused fallback.
- Attention navigation tests for the exact ordering, reason/age presentation,
  owning-goal `!N`/`?N` aggregation, stable positions and the `g` then `Enter`
  attach path.
- Semantic-zoom tests that expose more label/detail in context and focus views
  without reflowing durable map positions.

### Herdr adapter contract tests

- Parse a real sanitised snapshot.
- Use recognized agent records as sessions and exclude pane-only terminals.
- Preserve opaque native identifiers.
- Report supported attachment capability accurately.
- Handle unavailable, empty and malformed responses.
- Never mutate Herdr during discovery.

### Manual acceptance

Using the current real Herdr environment:

1. start with no accepted AO goals;
2. discover every recognized agent session in the inbox (use at least 15 for
   the scale trial when the live environment provides them);
3. create three goals, including one P0 goal;
4. assign and rename sessions;
5. restart and confirm persistence;
6. place one real agent into a waiting state;
7. confirm it is promoted with an explanation and duration;
8. press `g` repeatedly and verify the exact attention ordering, owning-goal
   badges and reason/age text; use `Enter` to attach to the selected session;
9. search for another session, confirm it is focused in spatial context, and
   attach to it;
10. return with the same selection, floating card, map lens, semantic detail
    tier and viewport as far as the host permits; and
11. complete a goal, confirm it remains dimmed, then archive it explicitly.

## Implementation order

1. Establish Bun project, stable quality commands and module folders.
2. Implement Universe records, commands and in-memory tests.
3. Implement SQLite persistence and restart tests.
4. Implement Herdr snapshot parsing and reconciliation tests.
5. Implement Attention, universe-map and supporting projections.
6. Build the portable native OpenTUI spatial universe over those projections.
7. Add map focus/attachment and full return-state restoration.
8. Run the manual acceptance flow and begin one-week dogfood.

Do not create the daemon, web client or agent skill while completing these
steps. A second consumer should create those seams from evidence rather than
anticipation.

## Dogfood evidence

Record:

- time to identify all waiting sessions;
- time to find and attach to a named session;
- missed or falsely promoted attention items;
- number of sessions opened merely to rediscover purpose;
- goal/assignment edits required per day;
- stale or duplicate reconciliation failures; and
- whether AO or Herdr's sidebar was used first for orientation.

At the end of one week, decide whether to continue into live-state hardening,
simplify the model further, or stop.
