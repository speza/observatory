# Goal-centred agent orchestration map

Status: corrected V0 product direction; floating-card iteration  
Date: 2026-08-22  
Product: Observatory — an agent observatory

Technical design: [Observatory technical architecture](technical-architecture.md)

## Summary

People who run many AI agents do not primarily have a session-management
problem. They have an attention, orientation and accountability problem.

Current tools provide increasingly capable ways to start, persist, resume and
inspect agent sessions. Their primary overview remains a list or tree of
sessions grouped by project and annotated with process state. That representation
works for a handful of agents. At greater scale, the operator must maintain a
separate mental model of why every session exists, how the work relates, what is
blocked, what can be trusted, and where their judgment is needed.

This project explores a provider-independent, goal-centred control plane. Its
first proof surface is a stable, portable native spatial map—rendered as a
cell-based universe of goal bodies and session satellites—over the real
Goal → Session topology. Flat attention and grouped-list views remain supporting
lenses for precise execution; they are not the core product proof.

The visual treatment is not the product by itself. It succeeds only if spatial
memory and goal/session geography make supervising agent work materially easier
than a well-designed list. The first live iteration must test that hypothesis
against real Herdr sessions rather than treating a flat list as sufficient
evidence.

## Why this should exist

### Agent execution has scaled faster than human supervision

Coding agents can work for long periods, operate concurrently and spawn other
agents. Multiplexers such as Herdr solve terminal persistence and switching.
Desktop products such as Codex and Claude Code improve parallel execution,
worktree isolation, diff review and resumption. Multi-provider dashboards add a
common place to see working, waiting and completed sessions.

These products make it easier to run more agents. They do not proportionally
increase the operator's capacity to understand and direct the resulting body of
work. More concurrency therefore produces an overloaded mental ledger.

### The session is the wrong primary unit

A session is an execution container. It is not necessarily the thing the user
cares about.

A durable goal may involve several repositories, worktrees and agents. A
chief-of-staff agent may delegate work to child sessions. Several agents may
research, implement and review the same worktree. Sessions may stop, compact,
resume or be replaced while the intended outcome remains unchanged.

Organising the world around sessions forces the user to reconstruct the durable
work from transient implementation details. The interface should instead centre
goals and outcomes, then show the sessions contributing to them.

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

## Problem statement

When an experienced agent user operates many active and idle sessions across
multiple projects and providers, they cannot quickly form and retain an accurate
picture of:

1. what outcomes are being pursued;
2. who or what currently owns each outcome;
3. how tasks, agents, repositories and worktrees relate;
4. what changed while they were elsewhere;
5. where progress is blocked or drifting;
6. what requires human judgment now; and
7. whether reported completion is supported by trustworthy artifacts.

Existing flat session lists expose individual runtime state but externalise this
larger model into the user's memory. This limits useful concurrency, creates
notification fatigue, makes dormant work easy to lose, and encourages shallow
acceptance of agent-reported completion.

## Target user

The initial user is a technical operator who:

- regularly runs multiple coding-agent CLIs;
- uses git worktrees to isolate parallel work;
- keeps sessions alive for hours, days or longer;
- mixes providers such as Claude Code, Codex, OpenCode or Pi;
- sometimes uses a central agent to plan and delegate to child agents; and
- remains responsible for steering, reviewing and integrating the outcome.

This is initially a single-player expert tool, not an enterprise workforce or
permissions product.

## Jobs to be done

### Orient

When I return after focusing elsewhere, help me reconstruct what changed and the
current shape of the work in minutes rather than reopening sessions one by one.

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

| Concept                | Possible representation                                           |
| ---------------------- | ----------------------------------------------------------------- |
| Goal or outcome        | Star system, planet or large region                               |
| Agent session          | Moving orb, spacecraft or compact child row                       |
| Chief-of-staff role    | Session with visible delegation relationships                     |
| Child agent            | Satellite linked to its parent                                    |
| Delegation             | Outbound path from parent to child                                |
| Result handoff         | Return path carrying an artifact                                  |
| Dependency             | Directed connection between outcomes                              |
| Pull request or merge  | Integration path back to the base branch                          |
| Conflict or overlap    | Intersecting or warning-marked paths                              |
| Human attention        | Salient pulse or halo                                             |
| Repository or worktree | Session inspector metadata or optional lens, never a default node |

This metaphor remains provisional. It must earn its place through usability
testing.

## The three topologies

The product must represent three related but distinct graphs.

### Work topology

Goals, delegated tasks, dependencies, decisions and intended outcomes.

### Agent topology

Agent roles, sessions, parent-child delegation, inherited instructions,
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
└── Agent role or session
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
multiple repositories, worktrees, providers and sessions. A goal can be as light
as a title and optional description; priority, success criteria, constraints and
decisions are progressive additions rather than required project-management
ceremony.

Sessions are assigned directly to goals and can query that shared context. This
gives independently running agents common intent without making AO responsible
for storing or replaying their transcripts.

V1 deliberately has no durable organisational layer between a goal and its
sessions. Delegation, dependency, review and Git relationships organise the
sessions without requiring another container. If real goals become too crowded,
a later version may add nested goals, workstreams or derived clusters based on
observed need. That shape is not chosen yet.

The interface may present a live tracked session as an agent. The durable
record remains the session because its process can stop, resume or be replaced
while its history and contribution to the goal remain relevant.

### AO is a semantic control plane

AO owns metadata and relationships, not agent execution or transcript storage.
It records native session identifiers and locators so agents and users can use
the provider's own session history when deeper context is required.

The control plane exposes an API and CLI so humans and agents can create goals,
assign sessions, record delegation, request attention and update progress. The
TUI and any later web or desktop clients are projections of this shared state.

Agent-supplied semantics are progressively enhanced:

1. vanilla sessions expose whatever can be discovered safely from their process,
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

## Session hosting

AO should not require Herdr and should not initially become a terminal
multiplexer. Session execution is provided through a pluggable host boundary.

```text
AO semantic control plane
├── Herdr session host — first live implementation
├── tmux session host — later
├── native session discovery
└── AO-native multiplexer — possible future implementation
```

A session host is responsible for discovering, launching, attaching to,
observing and stopping terminal sessions. AO is responsible for their meaning,
relationships and presentation. Terminal frontends such as Ghostty, Kitty and
WezTerm are a separate integration layer.

New implementation sessions should use a fresh Git worktree by default. Research
sessions may require none, and reviewers may attach read-only to an existing
worktree. AO should warn before two write-capable agents share a checkout.

## Interaction model

The universe is the navigation and attention surface. The hosted agent session
remains the authoritative conversation surface. AO should make lightweight
interventions possible without forcing the user to attach, but it should not
reimplement every provider's terminal or conversation interface.

Interaction follows a deliberate ladder:

```text
orient in universe
  -> select a session
  -> inspect its state and latest meaningful activity
  -> respond inline when the intervention is simple
  -> attach to the real session when full context is needed
  -> return to the preserved universe position
```

### Portfolio view

Show the whole universe with stable placement. Make attention, stalled work and
major integration risks visible without exposing every low-level edge.

### Goal view

Reveal contributing sessions, dependencies, delegated branches, worktrees,
artifacts, decisions, outstanding verification and convergence points for one
goal.

### Session view

Provide the real hosted terminal or provider-native conversation, plus access to
the plan, diff, context usage and controls. AO may frame or launch this view, but
the native session remains authoritative. Leaving it returns the user to the
same local navigation context: selected goal and session, filters and search,
plus position, zoom and active lens on surfaces that provide them.

### Selection and floating inspector card

Selecting a goal, session or the unassigned inbox does not immediately leave
the universe. It opens a transient floating card anchored near the selected
item. The card contains the smallest useful decision context:

- the reason the session needs attention;
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

1. every tracked session can expose AO metadata and an attachment route where
   the host provides one;
2. hosts may expose recent terminal output and text input;
3. hosts may optionally expose a full embedded-terminal stream;
4. provider integrations may expose meaningful activity, pending questions and
   structured responses; and
5. skills and hooks may add richer plans, blockers and result handoffs.

Unknown or unsupported interaction remains visibly unavailable rather than
being simulated unreliably.

### Attach and return

Attaching enters the existing hosted session. Depending on host capability this
may focus an existing pane, open an adjacent split, suspend AO and attach in the
foreground, or open an embedded terminal in a later local web client. Embedded
access transports a host-owned PTY stream; it does not make AO responsible for
the session lifecycle or require every host to support the same mechanism.

On return, AO restores the complete local navigation state. Attaching should
feel like descending into a node and returning to the same place, not reopening
the application from scratch.

Candidate input semantics are:

```text
single click on a goal           enter its goal-only satellite view
single click on a session        select and inspect
drag a goal body                 move its durable anchor; satellites follow
drag empty map or a session      pan the viewport
enter / double click            attach to the real session
escape / host return binding    return to the preserved universe
```

The exact keys remain configurable. Mouse gestures must have keyboard
equivalents.

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

The map's primary success criterion is the time from a session needing human
attention to the user attaching to the correct hosted session. It is not full
text legibility for every node at one scale. The map is the radar and navigation
surface; focused views, the inspector and the list lens are the detail surfaces.

Attention is both a projection and a navigation affordance:

- a current attention session gets an unmistakable steady marker and its owning
  goal aggregates `!N`;
- stale or uncertain state is separate and aggregates `?N`;
- the reason and age remain available in the attention queue, focused view and
  inspector;
- human-set `P0`–`P3` priority has a stable visual treatment distinct from
  transient attention; and
- attention changes emphasis, counters and jump targets, but never reflows an
  accepted spatial position.

The rapid-triage path is `g` to cycle through the exact attention ordering,
selecting the session and focusing its owning goal or inbox context, followed by
`Enter` to attach. `f` remains available to focus or reset the selected goal or
inbox context manually. The selected target, map lens, viewport and search state
are restored after returning from the hosted session as far as the host allows.

Semantic zoom is separate from geometric zoom. Geometric zoom changes camera
scale; semantic zoom changes label and metadata density without moving nodes. V0
has three presentation tiers:

- overview: the portfolio map, short labels, body size, priority, attention
  counts and direct tethers;
- context: selected and attention-bearing nodes receive expanded labels while
  their owning goal or inbox remains visible; and
- focus/detail: a focused goal or inbox shows larger or wrapped labels and the
  full direct orbit, while the inspector exposes complete execution metadata.

The attention lens dims healthy work while retaining the spatial positions of
promoted sessions and their owning goals. Search focuses a result in the same
spatial context. On narrow terminals, focus/detail is the fallback rather than
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

- goal size indicates durable scope and the number or weight of its sessions;
- orbiting or child nodes expose active agents, with active and total counts;
- a steady outer ring communicates human-set priority;
- pulsing animation may communicate required attention;
- brightness or fading communicates recency;
- a session ring communicates context pressure; and
- idle and completed sessions remain dim until a human archives them.

For V0, attention must also have a steady, high-contrast cell marker and an
explainable reason and age. Animation is optional and must never be the only
attention encoding.

New nodes receive the nearest deterministic free logical position. The placement
scan considers the current goal body and direct-satellite footprint, prefers a
compact horizontal portfolio, and expands its search when occupied space leaves
no suitable slot. Existing accepted nodes do not reflow when another goal or
session appears. Manual movement pins the goal anchor and its satellites remain
relative to it. Formatting is an explicit, undoable operation that can preserve
pinned positions; continuous auto-format is not the default assumption.

Type-to-find search should work from anywhere over goal and session
names and descriptions, including archived items. Selecting a result focuses it
inside its owning goal and the current view. Transcript search remains
provider-native initially.

## Terminal experience

The terminal is a first-class spatial surface, not a reduced fallback.

It should be a restrained, keyboard-first operational universe using portable
cells, typography, colour and limited semantic motion. It should not imitate a
graphical canvas through terminal-specific image protocols or a custom ANSI
raster engine. Its primary view is a stable portfolio of goal bodies with direct
session satellites; focused goal views expose one body's satellites. Attention,
inbox, inspector and grouped-list views are supporting lenses, and
infrastructure details remain session metadata.

Unassigned sessions remain visible without inventing another semantic layer:
the portfolio renderer gives them a neutral `INBOX` body with an orbit of
session cards, while narrow terminals replace that lens with a compact
selectable inbox panel. The body and panel are supporting lenses over direct
Goal → Session state, not durable map bodies. Satellites and inbox cards use
identity-derived collision-aware perimeter slots; the inbox adds a larger ring
when its current ring fills. In the full map, every unassigned session has a
direct muted cell tether to the inbox; selected and attention-bearing tethers
are stronger. The focused inbox lens keeps those tethers visible as the orbit
expands, while the 80x24 portfolio uses the compact selectable panel to protect
goal readability. Label width follows available cell scale, so dense portfolio
views shorten labels while focused and zoomed views expose more session
identity. This is deterministic slot allocation, not a force-directed graph
layout or continuous auto-formatting.

Goal placement is a separate free-space operation: new goals are placed against
the current occupied footprints, while accepted goal anchors remain stable.
Dragging a goal persists its world-space anchor and moves the direct satellite
orbit with it. Clicking a goal or using focus descends to a goal-only map that
contains that body and all of its direct sessions. Clicking the neutral inbox
body, or its narrow compact-panel header, descends to an inbox-only orbit; an
unassigned session selected elsewhere can enter the same lens with focus.

The experience should remain fully keyboard operable. Selecting an item should
open its floating inspector card; `Enter` on a session should open its real
terminal. Returning should preserve the selected goal and session, expansion
state, filters and search.

Herdr is the initial substrate because it already manages persistent
multi-provider sessions and exposes workspaces, panes, agents, worktrees,
snapshots, events and input through a local API.

A later local web client may own higher-fidelity observatory rendering: real
canvas composition, richer smooth zoom and pointer interaction. It
may be launched from the AO daemon and render an available host-owned terminal
stream with xterm.js. This is not an Electron or installed desktop-application
commitment. The two clients share meaning and actions, not identical visual
geometry.

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

For users managing at least 20 mixed active and idle sessions, compared with a
strong grouped session list:

- Returning users can accurately explain the state of their active goals in
  under two minutes.
- Users identify every agent requiring immediate human input without opening
  sessions individually.
- Users identify important cross-session dependencies, unconsumed results and
  worktree conflicts with fewer misses.
- Users can move from overview to the correct terminal, diff or artifact in
  under ten seconds.
- From an attention signal, users can reach the correct live session through the
  attention jump and attach path without scanning the whole map.
- Users can answer straightforward blocked sessions from the attention queue
  without attaching to each terminal individually.
- Users can distinguish runtime completion from verified, integration-ready
  completion.
- Users successfully resume dormant work without reconstructing its purpose from
  the transcript.

### Behavioural signals

- The user chooses the map for orientation and catch-up without being prompted.
- The user relies less on external notes or memory to track session purpose.
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
the rendering choice for this iteration. Native OpenTUI cells are sufficient
for a useful first spatial universe; the ANSI raster direction remains rejected.
The native client owns the first product proof, while a later local web client
may provide higher visual fidelity after the spatial information architecture
earns it.

The first live spatial iteration is a real walking slice rather than another
synthetic renderer. It should:

- discover existing Herdr sessions into an unassigned inbox;
- permit manual creation, naming and reprioritisation of goals;
- assign sessions directly to goals;
- render a free-space-aware portfolio map with stable goal bodies and direct
  session satellites;
- allow a human to move and persist a goal anchor while its satellites follow;
- provide a goal-only focused map containing exactly that goal and its direct
  sessions;
- focus a goal on narrow terminals while retaining the same map semantics;
- keep repositories, worktrees and runtime details on sessions and in the
  inspector rather than rendering them as nodes;
- surface a basic explainable attention queue;
- search goal and session metadata;
- jump to the relevant Herdr session and return without losing local state; and
- persist accepted organisation and goal positions across restart.

Quick messages, agent-authored structure, provider transcript parsing and the
web observatory follow only after this slice demonstrates value with real work.

On first use the accepted universe is empty. Discovered sessions appear in an
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

Measure completion time, errors, sessions opened, unnecessary interventions and
confidence.

Run the live prototype for one week with at least 15 real recognized agent
sessions. A strong
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

1. **Goals over sessions.** Durable intent owns the geography.
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
  continuously judge every session?
- Which context, token and cost metrics are consistently available?
- When should completed work leave the active universe, and how is it retrieved?
- Can the terminal command centre remain fast and legible at 100+ sessions?
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
