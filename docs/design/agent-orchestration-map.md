# Goal-centred agent orchestration map

Status: V1 model, linked execution and local web atlas walking slice implemented; roadmap in review
Date: 2026-08-25
Product: Observatory — an agent observatory

Technical design: [Observatory technical architecture](technical-architecture.md)
Feature roadmap: [Feature ownership and delivery](../specs/observatory-feature-roadmap.md)

## Summary

People who run many AI agents do not primarily have an agent-management
problem. They have an attention, orientation and accountability problem.

Current tools provide increasingly capable ways to start, persist, resume and
inspect agents. Their primary overview remains a list or tree of
agents grouped by project and annotated with process state. That representation
works for a handful of agents. At greater scale, the operator must maintain a
separate mental model of why every agent exists, how the work relates, what is
blocked, what can be trusted, and where their judgment is needed.

This project explores a provider-independent, goal-centred control plane. Its
primary proof surface is a stable graphical Atlas of goal bodies and agent
satellites over the real Goal → Agent topology. Flat attention and grouped-list
views remain supporting lenses for precise execution; they are not the core
product proof.

The visual treatment is not the product by itself. It succeeds only if spatial
memory and goal/agent geography make supervising agent work materially easier
than a well-designed list. The first live iteration must test that hypothesis
against real Herdr agents rather than treating a flat list as sufficient
evidence.

The product exists to answer the questions that become difficult when agent
execution is concurrent and long-lived:

1. What is all this work actually doing?
2. What changed while I was away?
3. Which result matters?
4. Where is my judgment needed?
5. Can I trust what says it is finished?

These are the product-purpose tests for Observatory. A map that shows agents
without making those answers easier is a visualisation, not an observatory.

## Why this should exist

### Agent execution has scaled faster than human supervision

Coding agents can work for long periods, operate concurrently and spawn other
agents. Multiplexers such as Herdr solve terminal persistence and switching.
Desktop products such as Codex and Claude Code improve parallel execution,
worktree isolation, diff review and resumption. Multi-provider dashboards add a
common place to see working, waiting and completed agents.

These products make it easier to run more agents. They do not proportionally
increase the operator's capacity to understand and direct the resulting body of
work. More concurrency therefore produces an overloaded mental ledger.

### A flat agent list is the wrong primary view

An Agent is a durable worker record and an execution identity, but it is not
enough context for supervision on its own.

A durable goal may involve several repositories, worktrees and agents. A
chief-of-staff agent may delegate work to child agents. Several agents may
research, implement and review the same worktree. Agents may stop, compact,
resume or be replaced while the intended outcome remains unchanged.

Organising the overview as a flat list of agents forces the user to reconstruct
the durable work from transient implementation details. The interface should
centre goals and outcomes, then show the Agents contributing to them.

### Process state is not work state

`working`, `waiting`, `idle` and `done` describe the runtime. They do not answer:

- Is the agent doing the right work?
- Is its result credible and verified?
- Has its parent agent consumed the result?
- Is another worktree changing the same files?
- Is the work waiting on another branch, decision or person?
- Which completed result should be reviewed first?
- What important work has gone quiet?

The interface must distinguish infrastructure health, behavioural progress,
verification state and integration state.

### Human attention is the scarce resource

The system should not maximise the number of agents running. It should help one
person apply judgment at the highest-leverage moments while safely allowing the
rest of the work to continue asynchronously.

The central product question is:

> Can an operator understand, steer and verify a large body of concurrent agent
> work without keeping its structure in their head?

The practical version is whether the operator can answer the five questions
above after returning to the system, without reopening every agent or relying
on memory of the previous session.

## Problem statement

When an experienced agent user operates many active and idle agents across
multiple projects and providers, they cannot quickly form and retain an accurate
picture of:

1. what outcomes are being pursued;
2. who or what currently owns each outcome;
3. how tasks, agents, repositories and worktrees relate;
4. what changed while they were elsewhere;
5. where progress is blocked or drifting;
6. what requires human judgment now; and
7. whether reported completion is supported by trustworthy artifacts.

Existing flat agent lists expose individual runtime state but externalise this
larger model into the user's memory. This limits useful concurrency, creates
notification fatigue, makes dormant work easy to lose, and encourages shallow
acceptance of agent-reported completion.

## Target user

The initial user is a technical operator who:

- regularly runs multiple coding-agent CLIs;
- uses git worktrees to isolate parallel work;
- keeps agents alive for hours, days or longer;
- mixes providers such as Claude Code, Codex, OpenCode or Pi;
- sometimes uses a central agent to plan and delegate to child agents; and
- remains responsible for steering, reviewing and integrating the outcome.

This is initially a single-player expert tool, not an enterprise workforce or
permissions product.

## Jobs to be done

### Orient

When I return after focusing elsewhere, help me reconstruct what changed and the
current shape of the work in minutes rather than reopening agents one by one.

### Triage

When several agents could consume my attention, show which intervention has the
highest leverage and why.

### Understand relationships

When work is delegated or split across branches, show ownership, dependencies,
handoffs, shared code surfaces and convergence points.

### Inspect and intervene

When something needs judgment, let me move from the overview to the exact agent,
terminal, diff or artifact without losing my place.

### Verify outcomes

When an agent says it is done, show the evidence required to decide whether the
result can be trusted, integrated, revised or discarded.

### Remember

When work becomes idle or dormant, preserve its location and meaning without
allowing it to dominate current attention.

## Product hypothesis

A stable spatial representation of durable work will reduce the mental effort
required to supervise many agents because it can make hierarchy, proximity,
delegation and dependency visible while supporting spatial memory.

The proposed visual language is:

| Concept                | Possible representation                                         |
| ---------------------- | --------------------------------------------------------------- |
| Goal or outcome        | Star system, planet or large region                             |
| Agent                  | Moving orb, spacecraft or compact child row                     |
| Chief-of-staff role    | Agent with visible delegation relationships                     |
| Child agent            | Satellite linked to its parent                                  |
| Delegation             | Outbound path from parent to child                              |
| Result handoff         | Return path carrying an artifact                                |
| Dependency             | Directed connection between outcomes                            |
| Pull request or merge  | Integration path back to the base branch                        |
| Conflict or overlap    | Intersecting or warning-marked paths                            |
| Human attention        | Salient pulse or halo                                           |
| Repository or worktree | Agent inspector metadata or optional lens, never a default node |

This metaphor remains provisional. It must earn its place through usability
testing.

## The three topologies

The product must represent three related but distinct graphs.

### Work topology

Goals, delegated tasks, dependencies, decisions and intended outcomes.

### Agent topology

Agent roles, parent-child delegation, inherited instructions,
authority, progress, results and accountability.

### Git topology

Repositories, base branches, worktrees, commits, changed files, pull requests,
checks, merge readiness and conflicts. These are execution facts and optional
relationships, not a required navigation hierarchy.

These graphs should be visually composable without being conflated. For example,
a chief-of-staff agent can dispatch three workers into separate worktrees, send
two reviewers to the same worktree, and run one research child that never touches
Git.

## Core information model

```text
Goal
├── Dependencies and decisions
└── Agent role or agent
    ├── Parent / children
    ├── Delegated task and authority
    ├── Context lineage
    ├── Runtime state
    ├── Repository, branch and worktree metadata
    ├── Commits, changed files and verification artifacts
    ├── Pull request / integration state
    └── Result and consumption state
```

The model must tolerate partial knowledge. Relationships can be detected,
declared by agents, inferred tentatively, or added manually by the user. The UI
must distinguish those provenance levels.

### Goals are the primary object

Goals are the largest and most durable objects in the universe. They can span
multiple repositories, worktrees, providers and agents. A goal can be as light
as a title and optional description; priority, success criteria, constraints and
decisions are progressive additions rather than required project-management
ceremony.

Agents are assigned directly to goals and can query that shared context. This
gives independently running agents common intent without making AO responsible
for storing or replaying their transcripts.

V1 deliberately has no durable organisational layer between a goal and its
agents. Delegation, dependency, review and Git relationships organise the
agents without requiring another container. If real goals become too crowded,
a later version may add nested goals, workstreams or derived clusters based on
observed need. That shape is not chosen yet.

The durable record remains the Agent because its host execution can stop,
resume or be replaced while its history and contribution to the Goal remain
relevant. Supporting shells and sibling-agent executions are host context, not
additional durable records.

### Zero-configuration code-context experiment

Manual goals are useful for durable intent but should not be a prerequisite for
getting an understandable first view. Observatory now has an experimental
supporting lens that groups discovered agents by their observed repository,
falling back to the observed worktree or an explicitly labelled unknown
context. The grouping is a projection, not an accepted organisational object;
it does not infer a goal or create a new map topology.

The experiment treats an agent's primary repository and worktree as one code
context for presentation. In the map/universe view, each observed context is a
derived body with its agents arranged as satellites; in the list view, the
same grouping is shown as a supporting hierarchy. The agent remains the
selectable object and keeps its branch/worktree facts alongside its host
identity. A repository may contain several agents in distinct worktrees,
while one agent can later report additional repository involvement if that
evidence becomes available. The current implementation deliberately does not
persist a separate worktree entity or infer a multi-repository goal.

The related-agent lens adds a human-controlled bridge from those observations
back to an existing goal. An optional host-provided execution-container
reference is compared opaquely across agents; matching worktrees are strong
evidence and matching repositories are supporting evidence. These signals
produce candidates, not accepted relationships. From a selected goal in the
map or list, a human can batch-adopt unassigned candidates into the Goal ->
Agent assignment or dismiss them for that goal. Agents already assigned to
another goal remain visible as context but are not adoptable, and missing or
stale signals never become semantic truth.

### AO is a semantic control plane

AO owns metadata and relationships, not agent execution or transcript storage.
It records native agent identifiers and locators so agents and users can use
the provider's own agent history when deeper context is required.

The control plane exposes an API and CLI so humans and agents can create goals,
assign agents, record delegation, request attention and update progress. The
local web GUI is a projection of this shared state. Any later structured client
must follow the same boundary and must not read persistence directly.

Optional external context is plugin-contributed. GitHub pull requests, Jira or
Linear tickets and provider-specific facts should appear as provenance-bearing
related resources or supporting lenses, not as hard-coded kernel fields or a
new required topology layer. See the [plugin architecture](plugin-architecture.md)
for the boundary and failure rules.

Agent-supplied semantics are progressively enhanced:

1. vanilla agents expose whatever can be discovered safely from their process,
   provider, repository, worktree and native metadata;
2. optional skills, hooks and integrations report richer goals, delegation,
   blockers, handoffs and context pressure; and
3. unknown state remains visibly unknown rather than being invented.

The product must remain useful with unmodified Claude Code, Codex, OpenCode and
Pi installations. Enhanced tracking should be simple to install rather than a
prerequisite.

### Human authority and auto mode

Agent activity does not wait for approval of its proposed map structure.
Structure acceptance determines what becomes trusted organisational state, not
whether an agent may continue executing.

- Humans own goal priority and authoritative completion by default.
- Agents may propose goals, relationships and completion.
- Trusted auto mode may let an agent organise work within agreed boundaries.
- Whether auto mode may create top-level goals remains an experiment.
- Agent-completed goals remain visible and greyed until a human archives them.
- Archiving hides history from the active universe; it does not delete it.

## Agent hosting

Herdr is a deliberate V0/V1 requirement for live agent execution, but it is
not Observatory's architectural centre. Agent execution is provided through
one pluggable host boundary so Herdr can later be replaced or joined by tmux,
a Superlogical-style host, or an Observatory-owned multiplexer without
rewriting the semantic control plane.

```text
AO semantic control plane
├── Herdr agent host — first live implementation
├── tmux agent host — later
├── native agent discovery
└── AO-native multiplexer — possible future implementation
```

An agent host is responsible for discovering, launching, attaching to and
observing terminal agents, while retaining ownership of their process and
terminal lifecycle. AO is responsible for their meaning, relationships and
presentation. Terminal frontends such as Ghostty, Kitty and WezTerm are a
separate integration layer. Herdr's workspaces, tabs and panes are host
metadata, not AO topology.

This is an explicit dependency-inversion policy:

- `SessionHost` is the only host interface visible to the control plane;
- Herdr protocol details and native identifiers live only in its adapter and
  the composition root;
- generic capabilities are added only when a real host needs them, with an
  explicit unsupported result otherwise; and
- replacing the Herdr adapter with another host must not require changes to
  Universe, persistence, projections or renderers.

The mock host proves that the control plane and renderer can run without a
live Herdr instance. A second production host will be treated as an adapter
contract test, not as a reason to broaden the domain model.

New implementation agents should use a fresh Git worktree by default. Research
agents may require none, and reviewers may attach read-only to an existing
worktree. AO should warn before two write-capable agents share a checkout.

### Linked executions

When an Agent is selected, its host may expose N transient linked executions:
shells for local applications, tests, watchers and preferred diff tools, plus
recognised sibling Agents in the same host context. Observatory offers these in
the Agent inspector and opens selected entries as companion terminal tabs. The
map does not render them as nodes, and shell-only panes are not
reconciled into the durable Agent inventory. If a person starts a supported
Agent in a linked shell, the next authoritative host snapshot can reconcile it
as a normal Agent using its existing native identity.

## Interaction model

The universe is the navigation and attention surface. The hosted agent
remains the authoritative conversation surface. AO should make lightweight
interventions possible without forcing the user to attach, but it should not
reimplement every provider's terminal or conversation interface.

Interaction follows a deliberate ladder:

```text
orient in universe
  -> select an agent
  -> inspect its state and latest meaningful activity
  -> respond inline when the intervention is simple
  -> attach to the real agent when full context is needed
  -> return to the preserved universe position
```

### Portfolio view

Show the whole universe with stable placement. Make attention, stalled work and
major integration risks visible without exposing every low-level edge.

### Goal view

Reveal contributing agents, dependencies, delegated branches, worktrees,
artifacts, decisions, outstanding verification and convergence points for one
goal.

### Agent view

Provide the real hosted terminal or provider-native conversation, plus access to
the plan, diff, context usage and controls. AO may frame or launch this view, but
the native agent remains authoritative. Leaving it returns the user to the
same local navigation context: selected goal and agent, filters and search,
plus position, zoom and active lens on surfaces that provide them.

### Selection and floating inspector card

Selecting a goal or agent does not immediately leave the universe. It opens a
transient floating card anchored near the selected item. The card contains the
smallest useful decision context:

- the reason the agent needs attention;
- the pending question, approval or requested judgment where known;
- the latest meaningful activity rather than arbitrary terminal noise;
- the goal;
- repository, branch, worktree and change summary;
- runtime and verification state; and
- actions supported by the current host and provider.

A transcript tail or terminal preview is optional and read-only. It helps the
user decide whether to attach, but must not turn the card into a second full
conversation client. The card is clamped to the map or list surface and does
not reserve a permanent right-hand panel; `i` hides or restores it. On a narrow
terminal it shortens its copy before the map gives up space, and focused goal
or inbox lenses remain the fallback for dense universes.

### Quick interaction

When the host supports input, the user can send a short message while remaining
in the universe. When an integration exposes a structured pending question or
approval, the card may present its choices directly while always allowing a
free-form response or attachment for more context.

Clearing several waiting agents from the attention queue without visiting every
terminal is a core product workflow. AO must show the exact target before
sending and must not provide broadcast input in v1.

Capability degrades progressively:

1. every tracked agent can expose AO metadata and an attachment route where
   the host provides one;
2. hosts may expose recent terminal output and text input;
3. hosts may optionally expose a full embedded-terminal stream;
4. provider integrations may expose meaningful activity, pending questions and
   structured responses; and
5. skills and hooks may add richer plans, blockers and result handoffs.

Unknown or unsupported interaction remains visibly unavailable rather than
being simulated unreliably.

### Attach and return

Attaching enters the existing hosted agent. Depending on host capability this
may focus an existing pane, open an adjacent split, suspend AO and attach in the
foreground, or open an embedded terminal in a host-backed client. The maintained
web GUI uses the generic Herdr-backed terminal stream through its guarded
loopback gateway. Embedded access transports a host-owned PTY stream; it does
not make AO responsible for the agent lifecycle or require every host to
support the same mechanism.

On return, AO restores the complete local navigation state. Attaching should
feel like descending into a node and returning to the same place, not reopening
the application from scratch.

### Closeout and host lifecycle

The web Closeout surface reduces lifecycle housekeeping without weakening the
distinction between observation and accepted truth. Runtime `done` enters a
results-to-review lane; host absence enters an ended-externally lane and never
becomes completion. Stale Agents may be shelved from the active Atlas as a
reversible projection choice before the human archives them.

For a live Agent, `Close & archive` first asks the generic session host to close
the revalidated opaque execution and only then archives Observatory's semantic
record. `Archive only` remains an explicit secondary action when the operator
wants the execution to continue. Host-specific stop mechanics stay inside the
adapter, and automatic host termination requires a later explicit policy. The
delivery and failure plan is specified in
[Agent closeout and host lifecycle](../specs/agent-closeout-and-host-lifecycle.md).

Candidate input semantics are:

```text
single click on a goal           enter its goal-only satellite view
single click on an agent        select and inspect
drag empty map                   pan the viewport
enter / double click            attach to the real agent
escape / host return binding    return to the preserved universe
```

Persisted goal movement remains the next position-editing slice rather than a
current browser gesture. The exact keys remain configurable. Mouse gestures
must have keyboard equivalents.

### Attention queue

Retain a precise, keyboard-friendly list alongside the spatial view. The map is
for orientation and relationships; the queue is for rapid execution. Both are
projections of the same underlying state.

Attention is ordered first by whether human intervention is required. For V0,
items requiring intervention are ordered by human-set goal priority, longest
current wait and most recent host observation as the final tie-breaker.
Intervention type and downstream work blocked remain future candidates, not
additional V0 ordering rules. Strategically important but healthy work remains
visible without competing with an item that needs action.

### V0 attention-first navigation and semantic zoom

The map's primary success criterion is the time from an agent needing human
attention to the user attaching to the correct hosted agent. It is not full
text legibility for every node at one scale. The map is the radar and navigation
surface; focused views, the inspector and the list lens are the detail surfaces.

Attention is both a projection and a navigation affordance:

- a current attention agent gets an unmistakable steady marker and its owning
  goal aggregates `!N`;
- stale or uncertain state is separate and aggregates `?N`;
- the reason and age remain available in the attention queue, focused view and
  inspector;
- human-set `P0`–`P3` priority has a stable visual treatment distinct from
  transient attention; and
- attention changes emphasis, counters and jump targets, but never reflows an
  accepted spatial position.

The rapid-triage path is `g` to cycle through the exact attention ordering,
selecting the agent and focusing its owning goal or inbox context, followed by
`Enter` to attach. `f` remains available to focus or reset the selected goal or
inbox context manually. The selected target, map lens, viewport and search state
are restored after returning from the hosted agent as far as the host allows.

Semantic zoom is separate from geometric zoom. Geometric zoom changes camera
scale; semantic zoom changes label and metadata density without moving nodes. V0
has three presentation tiers:

- overview: the portfolio map, short labels, body size, priority, attention
  counts and direct tethers;
- context: attention-bearing nodes receive expanded labels while their owning
  goal or inbox remains visible; the selected node receives the detail tier so
  its title remains fully identifiable; and
- focus/detail: a focused goal or inbox keeps the full direct orbit while
  following the current label tier; dense healthy satellites may be compact
  status markers in overview, with context/detail restoring short or wrapped
  labels, while the inspector exposes complete execution metadata.

At low geometric zoom, overview cards collapse to glyphs and priority markers.
Selected and attention-bearing nodes keep their labels so the map remains
navigable without letting fixed-size detail overwhelm the viewport.

The attention lens dims healthy work while retaining the spatial positions of
promoted agents and their owning goals. Search focuses a result in the same
spatial context. On narrow viewports, focus/detail is the fallback rather than
compressing the whole universe until labels become unusable.

### Catch-up mode

Summarise changes since the user's last visit, grouped by outcome rather than as
an undifferentiated event stream. Highlight decisions, failures, newly produced
artifacts, delegation changes and integration risks.

## Visual encoding principles

Every visual property must have a defined meaning.

- Physical position should remain stable unless the user moves an object or its
  durable parent changes.
- Motion should represent delegation, work, result return or integration—not
  ambient decoration.
- Colour should primarily communicate state and attention.
- A node's main size should represent durable scope or accumulated output, not
  mere verbosity.
- Context utilisation should be shown as a ring or atmosphere around an agent,
  leaving the underlying geography stable.
- Recent activity may affect glow or particle flow.
- Approaching compaction, unconsumed results and stale work should be distinct.
- Important state must remain legible without colour or animation.

Candidate size modes may include output, context, cost, duration and attention,
but changing modes must not rearrange the map.

The initial overview should show goals and one level of children with containment
edges only. Deeper delegation and Git topology appear when a goal is selected or
the corresponding lens is enabled. A deeply nested blocker must still warn at
the goal level and be reachable directly from that warning.

Candidate default encodings are:

- goal size indicates durable scope and the number or weight of its agents;
- orbiting or child nodes expose active agents, with active and total counts;
- a steady outer ring communicates human-set priority;
- pulsing animation may communicate required attention;
- brightness or fading communicates recency;
- an agent ring communicates context pressure; and
- idle and completed agents remain dim until a human archives them.

For V0, attention must also have a steady, high-contrast cell marker and an
explainable reason and age. Animation is optional and must never be the only
attention encoding. Live `working` agents may use a restrained rotating
half-moon marker and border pulse to distinguish active execution from a live
but idle agent; runtime state remains available as text in detail/list views.

New nodes receive the nearest deterministic free logical position. The placement
scan considers the current goal body and direct-satellite footprint, prefers a
compact horizontal portfolio, and expands its search when occupied space leaves
no suitable slot. Existing accepted nodes do not reflow when another goal or
agent appears. Manual movement pins the goal anchor and its satellites remain
relative to it. Formatting is an explicit, undoable operation that can preserve
pinned positions; continuous auto-format is not the default assumption.

Type-to-find search should work from anywhere over goal and agent
names and descriptions, including archived items. Selecting a result focuses it
inside its owning goal and the current view. Transcript search remains
provider-native initially.

## GUI experience

The local GUI is a restrained, keyboard-accessible operational universe using
native SVG, HTML, typography, colour and limited semantic motion. Its primary
view is a stable portfolio of goal bodies with direct agent satellites; focused
goal views expose one body's satellites. Attention, Inbox, inspector and Ledger
views are supporting lenses, and infrastructure details remain agent metadata.

Unassigned agents remain discoverable without becoming map topology: the
portfolio hides their cards and exposes the Inbox count and lens instead.
The list is a supporting lens over direct Goal → Agent state, not a durable
map body. Stale or unavailable host state is called out in the header and
remains actionable through the list and attention lenses. Attention and
focused inbox lenses expose the compact, attention-first list. Goal satellites continue to use
identity-derived collision-aware perimeter slots; this is deterministic slot
allocation, not a force-directed graph layout or continuous auto-formatting.

Stale or unavailable agents remain in those supporting lenses until a human
selects one and confirms `x` to archive it. Archiving removes it from active
map/list projections while retaining its identity, assignment and host history;
a later host refresh may update the archived record but must not silently bring
it back.

Goal placement is a separate free-space operation: new goals are placed against
the current occupied footprints, while accepted goal anchors remain stable.
The Universe already accepts durable moved anchors, but browser position
editing remains outstanding. Clicking a goal or using focus descends to a
goal-only map that contains that body and all of its direct agents. Selecting
an unassigned agent keeps the supporting Inbox context. Creating a goal selects
it automatically; assignment remains an explicit inspector action.

Map keyboard navigation follows the visible hierarchy rather than flattening
it: `j`/`k` or arrow keys move through selectable Goals and Agents, while the
supporting Ledger and queue surfaces retain ordered row navigation.

The experience should remain fully keyboard operable. Selecting an item should
open its floating inspector card; `Enter` on an agent should open its real
host-owned terminal in the browser. Returning should preserve the selected goal
and agent, camera, filters and search.

Herdr is the initial substrate because it already manages persistent
multi-provider agents and exposes workspaces, panes, agents, worktrees,
snapshots, events and input through a local API.

The local web client now owns the higher-fidelity observatory rendering:
responsive native SVG composition, crisp labels, smooth zoom and pointer
interaction. Its production walking slice is in-process over the same
universe-map, command-centre, catch-up and inspector projections, with a narrow
Universe command gateway. It is the sole maintained product client, not an
Electron or installed desktop-application commitment. Herdr remains the native
terminal fallback rather than Observatory maintaining a second UI. Delivery
order is maintained in the [feature roadmap](../specs/observatory-feature-roadmap.md).

The Atlas remains the primary orientation surface. The attention queue is the
supporting action lens and the Ledger is the same-data precision/list baseline.
Neither replaces the spatial hypothesis. Catch-up and terminal work surfaces
now use production boundaries rather than renderer fixtures: catch-up comes
from a durable core checkpoint and deterministic semantic-change projection,
while the floating browser terminal consumes the generic host-owned terminal
capability through a guarded loopback stream. Neither surface invents browser
state that the Universe or SessionHost does not own.

## Attention model

Attention must be computed from explainable signals rather than a mysterious
importance score. Candidate signals include:

- explicit request or approval needed;
- parent agent waiting for a child result;
- returned result not yet consumed;
- failed verification or CI;
- dirty, idle or orphaned worktree;
- overlapping changed files across active worktrees;
- approaching context exhaustion;
- stalled activity relative to the expected task state;
- PR awaiting review or integration; and
- user-pinned importance or deadline.

The interface must explain why an item is demanding attention.

## Success

The product succeeds if it measurably expands useful human supervision capacity,
not merely if users enjoy looking at it.

### Primary outcomes

For users managing at least 20 mixed active and idle agents, compared with a
strong grouped agent list:

- Returning users can accurately explain the state of their active goals in
  under two minutes.
- Users identify every agent requiring immediate human input without opening
  agents individually.
- Users identify important cross-agent dependencies, unconsumed results and
  worktree conflicts with fewer misses.
- Users can move from overview to the correct terminal, diff or artifact in
  under ten seconds.
- From an attention signal, users can reach the correct live agent through the
  attention jump and attach path without scanning the whole map.
- Users can answer straightforward blocked agents from the attention queue
  without attaching to each terminal individually.
- Users can distinguish runtime completion from verified, integration-ready
  completion.
- Users successfully resume dormant work without reconstructing its purpose from
  the transcript.

### Behavioural signals

- The user chooses the map for orientation and catch-up without being prompted.
- The user relies less on external notes or memory to track agent purpose.
- The user can supervise more concurrent work without increasing missed
  interventions or accepting more defective outcomes.
- Stable locations become meaningful enough that the user refers to where work
  is situated.
- The attention queue is acted on because its prioritisation is trusted.

### Failure signals

- The map is praised visually but users return to the list for real work.
- Users cannot predict where nodes will appear after state changes.
- Animation creates urgency without improving decisions.
- Users confuse agent hierarchy, work dependencies and Git relationships.
- Maintaining the map requires substantial manual administration.
- More visible activity encourages unnecessary agent concurrency.
- `done` remains easier to perceive than evidence of correctness.

## Rendering discovery outcome

The disposable OpenTUI, visual-fidelity and ANSI half-block experiments closed
the initial rendering investigation. Native cells were sufficient to prove the
spatial boundary, while the ANSI raster direction remained rejected. The native
client was retired on 2026-08-27; the local React/SVG GUI is now the sole
maintained product renderer.

The first live spatial iteration is a real walking slice rather than another
synthetic renderer. It should:

- discover existing Herdr agents into an unassigned inbox;
- permit manual creation, naming and reprioritisation of goals;
- assign agents directly to goals;
- render a free-space-aware portfolio map with stable goal bodies and direct
  agent satellites;
- allow a human to move and persist a goal anchor while its satellites follow;
- provide a goal-only focused map containing exactly that goal and its direct
  agents;
- focus a goal on narrow viewports while retaining the same map semantics;
- keep repositories, worktrees and runtime details on agents and in the
  inspector rather than rendering them as nodes;
- surface a basic explainable attention queue;
- search goal and agent metadata;
- jump to the relevant Herdr agent and return without losing local state; and
- persist accepted organisation and goal positions across restart.

Quick messages, agent-authored structure and provider transcript parsing remain
later. The web observatory follows the accepted semantic-core boundary and must
now demonstrate value with real work.

On first use the accepted universe is empty. Discovered agents appear in an
unassigned inbox until the user imports or assigns them. Accepted goals,
relationships and assignments persist across restarts.

Test the spatial universe against Herdr's existing sidebar and grouped-list
lens. Ask users to:

1. find the next agent requiring judgment;
2. explain a project's state after time away;
3. identify duplicated, dependent or conflicting work;
4. find a returned result not yet consumed by its parent;
5. resume a relevant dormant thread; and
6. decide whether a completed task is ready to integrate.

Also record whether the user chooses the map for orientation, whether stable
locations become meaningful, and whether a focused goal view makes direct
satellites faster to understand than opening the sidebar.

Measure completion time, errors, agents opened, unnecessary interventions and
confidence.

Run the live prototype for one week with at least 15 real recognized agent
agents. A strong
failure signal is that the user still opens Herdr's sidebar first to understand
what exists, what matters or what needs attention. Other pivot signals are that
known work is slower to find, goal maintenance feels administrative, ordering
feels unpredictable, attention indicators become noise, or the existing sidebar
remains preferable for tasks other than exact search.

## Scope boundaries

The first version is not:

- a new coding agent;
- an autonomous planner or dispatcher;
- a replacement terminal multiplexer;
- a complete Git client;
- a multi-user project-management suite;
- an enterprise governance platform; or
- a 3D game requiring free-flight navigation.

It should initially observe and navigate existing work while allowing users and
agents to mutate AO metadata. Direct execution control and automated
orchestration should expand only after the information model proves useful.

Full structural audit history is not required for v1. Internally retaining basic
change provenance is desirable, but the first interface does not need a dedicated
history browser.

## Product principles

1. **Goals over agents.** Durable intent owns the geography.
2. **Attention over activity.** Busy is not necessarily important.
3. **Evidence over self-report.** Completion requires inspectable artifacts.
4. **Stable space over clever layout.** Spatial memory depends on persistence.
5. **One model, several views.** Map, list, timeline and terminal must agree.
6. **Relationships are typed.** Delegation, dependency and Git integration are
   not interchangeable edges.
7. **The human remains in the loop.** The system explains and enables; it does
   not silently accept, merge or discard work.
8. **Delight must carry information.** Every glow, orbit and animation should
   help the operator understand or act.

## Open questions

- Which relationships can be discovered reliably across agent providers?
- How should a central agent declare delegation, authority and expected return?
- How can behavioural drift be detected without asking another model to
  continuously judge every agent?
- Which context, token and cost metrics are consistently available?
- When should completed work leave the active universe, and how is it retrieved?
- Can the terminal command centre remain fast and legible at 100+ agents?
- Does spatial memory still help when the underlying work changes rapidly?
- What information must remain local, particularly agent transcripts and
  repository contents?

## Research basis

- [Herdr documentation](https://herdr.dev/docs/)
- [Herdr socket API](https://herdr.dev/docs/socket-api/)
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- [Claude Code desktop for parallel agents](https://claude.com/blog/claude-code-desktop-redesign)
- [Agent View in Claude Code](https://claude.com/blog/agent-view-in-claude-code)
- [Human oversight of agentic systems in practice](https://arxiv.org/abs/2606.05391)
- [Managing Multi-Agent Research Systems](https://heal-workshop.github.io/chi2026_papers/Managing%20Multi-Agent%20Research%20Systems%20A%20Dashboard%20for%20Human%20Oversight%20of%20Coordin.pdf)
- [Testing the Limits of the Spatial Approach](https://graphicsinterface.org/proceedings/gi2020/gi2020-22/)
