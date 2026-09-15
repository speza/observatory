# Goal-centred agent orchestration map

Status: implemented V1 product model; spatial value under active evaluation
Updated: 2026-09-14

Related documents:

- [Technical architecture](technical-architecture.md)
- [Feature roadmap](../specs/observatory-feature-roadmap.md)
- [Competitive landscape and spatial product bet](competitive-landscape-and-spatial-product-bet.md)

## Summary

People supervising many coding agents do not primarily have an agent-management
problem. They have an attention, orientation, accountability and verification
problem.

Observatory tests one product hypothesis: a stable spatial universe organised
around human Goals can make concurrent agent work easier to supervise than a
flat list. Its durable geography is `System → Goal → Agent`, with direct System-level
Agents available when no outcome has been chosen. Atlas is the primary proof
surface; Ledger, Needs you, Catch up, Inbox, inspector, workspace
review and terminals are supporting lenses over the same trusted state. Live
host executions with recognized exact conversation identity are synchronized
into Inbox Agents; ambiguous or unidentified executions remain in a separate
transient `Discovered in Herdr` surface.

## Positioning

Observatory is the single place where an operator's agent work is organised by
intent, verified against evidence, and decided by the operator, regardless of
where the agents run.

Observation alone is a commodity capability. The defensible claim is
accountability: observe, notice, judge, verify, intervene. Agent counts grow
faster than human attention, so supervision must concentrate into judgment over
evidence rather than direct observation. "All my agents" is a
host-neutrality claim and must stay honest. For V0/V1, Herdr is the only live
host, so the truthful current scope is every agent the operator runs in Herdr
across its supported providers and CLIs. The `SessionHost` seam exists so that
supporting a future host never requires changing the Universe, persistence,
projections or renderer; the positioning sentence becomes fully true without a
rewrite.

Every surface must also close the review loop in one place. A needs-you item
must be resolvable — read the evidence, accept, reject or intervene — without
bouncing to a second tool. Observatory is one deliberate destination for
judgment, not another hop per item.

## Operator questions

The product should answer five questions quickly:

1. What is the work doing?
2. What changed while I was away?
3. Which result matters?
4. Where is my judgment needed?
5. Can I trust that finished work is actually finished?

Activity alone cannot answer these questions. A busy process may be irrelevant;
a completed process may still need review; a missing runtime may represent a
dormant resumable conversation rather than lost work.

## Target operator

The initial user is a technical individual supervising roughly 10–100 concurrent
or recently active coding-agent conversations across projects and worktrees.
They already use terminal-native agent tools and Git, are comfortable reviewing
code, and need stronger orientation without surrendering semantic control.

Observatory is not currently a multi-user planning suite, enterprise governance
system or autonomous dispatcher.

## Durable information model

### System

A System is a broad human-authored area of work. It can span repositories,
worktrees, hosts and providers. Systems scope the top-level portfolio without
turning infrastructure into organisation.

A reserved `Default` System is seeded automatically and receives Goals created
without an explicit System. It is an ordinary, renamable System and behaves like
any other scope; it exists so that organisation never blocks starting work.

### Goal

A Goal is a durable human intention within a System. It owns priority,
completion, archive, accepted map position and direct Agent assignments. Goal
lifecycle remains human-controlled. Goals are optional for Agents: exploratory,
project-level or cross-repository work can sit directly under its System until
an outcome is selected.

### Agent

An Agent is a durable, exactly identified provider conversation. It may have a
current host execution, a previous execution, no execution, or conflicting
execution evidence. Process and host lifecycle never replace conversation
identity. An Agent may be assigned to one active Goal, assigned directly to one
System without a Goal, or remain in Inbox; direct System placement is human
controlled and never inferred from execution metadata.

### Supporting facts

Repository, branch, worktree, host, execution group, immediate execution
context (including a workspace/tab breadcrumb), explicit individual execution
label, provider activity, pull request and checks are evidence attached to an
Agent. They support review, search and related-work proposals but do not become
map hierarchy. The group, immediate context and individual label remain
separate so a linked worktree or named tab context does not erase the explicit
execution name that distinguishes a sibling.

## Authority and uncertainty

Observatory separates accepted semantic state from observed facts.

- Humans own Systems, Goals, placement, priority, completion and archive.
- A recognized exact host conversation may create an identity-only Inbox Agent;
  host evidence never assigns a Goal or System or invents human semantics.
- Providers own conversation identity and provider-native lifecycle evidence.
- Session hosts own execution, process and terminal facts.
- Plugins contribute bounded observations or proposals.
- Universe commands are the only way to change trusted state.

Missing or weak evidence remains visible as unknown, stale, unavailable,
possibly running or conflicting. Repository similarity, cwd, title and recency
must not silently transfer a Goal or join two conversations.

## Spatial hypothesis

Stable geography should reduce the amount of work the operator reconstructs in
memory. The layout therefore follows these rules:

- Systems provide broad portfolio scope rather than map bodies.
- Fresh live host execution territories follow the host's workspace grouping,
  qualified by host instance and laid out from an opaque grouping identity
  without exposing it. For Herdr, linked Git worktree workspaces share the
  source repository workspace's territory; plain workspaces at the same
  checkout remain separate.
- Agents retain their observed execution and worktree metadata; a host grouping
  is only a projection convenience. A territory can contain multiple Goals and
  one Goal can span multiple territories.
- Goals remain human-authored semantic overlays on Agent cards and selections,
  not inferred runtime containers.
- Live or uncertain Agents without fresh workspace evidence remain visible in
  one explicit workspace-less area. Confirmed-absent executions leave the
  active Atlas but their durable Agent history remains searchable.
- Adding unrelated work does not globally reflow existing workspace geography.
- Attention changes emphasis and navigation, not durable position.
- Repositories and hosts never become spatial parent nodes.
- Discovered executions share one labelled, compact dock placed below the
  rendered universe footprint; it never relocates accepted Goals or implies
  System membership.

Space must carry semantic value. If operators consistently choose Ledger or a
host sidebar to orient, the Atlas hypothesis has failed regardless of visual
appeal.

## Product surfaces

### Systems overview

The entry view summarises broad Systems by Goal and Agent load, current work and
Needs-you count. Entering a System reveals its Atlas or Ledger, including Agents
that are placed directly in the System without a Goal.

### Atlas

Atlas shows fresh live host execution territories as its primary geography,
with Agents in compact card grids. The projection follows host-reported
workspace grouping across Goal boundaries, includes single-Agent territories,
qualifies opaque grouping equality by host instance and emits only safe labels,
public Agent views and derived positions. Tabs and panes remain host-owned
placement details rather than map grouping levels.

Each Agent card carries its Goal as a coloured semantic tag. Its primary title
uses an explicit live individual label when the Agent name is provider- or
fallback-derived, then falls back to the immediate execution context (which may
be a named workspace/tab breadcrumb); an explicit human name remains
authoritative. Group and immediate execution context are shown as secondary
card, navigation and inspector context. Selecting a Goal highlights and fits all
of its Agents across workspace territories. This keeps human intent visible without claiming a false
Workspace-to-Goal 1:1 invariant.
Agents whose workspace evidence is missing, stale or unavailable appear in a
separate labelled area rather than being assigned by inference or omitted.

Atlas also shows a labelled `Discovered in Herdr` dock for current
host-reported executions that cannot be safely synchronized into an Agent. This
includes unidentified, ambiguous and explicitly untrusted identity evidence.
The dock starts collapsed to a compact heading and can be expanded when the
operator wants to inspect or explicitly admit its cards. Expanded, it is a
single compact grid anchored below the rendered universe footprint, workspace
territories and workspace-less cards included, and drawn with its own bounded
frame so it reads as one neutral staging area rather than scattered cards.
These cards are visibly separate from Goal or System geography and carry safe
host/runtime/workspace metadata, freshness and conversation-identification
state. Selecting one opens the same inspector; terminal access is available
through a freshly validated SessionHost capability. Exact catalogue evidence
enables explicit admission for these exceptions, and promotion replaces the
discovery card while retaining the selection.

Geometric zoom changes camera scale. Presentation density changes labels and
metadata while preserving positions. Selected and attention-bearing work retain
identity at low density. Goal focus fits all matching Agent cards across their
workspace territories within the viewport left after reserving the Inspector
or another side panel. Individual Agent focus retains the
1.45 zoom cap. The camera uses an absolute world origin; projection refreshes do
not refit the overview. Active focus adapts to viewport and panel changes until
the operator manually pans or zooms. Terminal entry, switching and return retain
background panel context rather than reframing the map; explicit System changes
start a new fitted view.

Workspace positions are currently deterministic projections of qualified live
container identity, not durable accepted coordinates. Membership changes resize
an island and can alter portfolio fit without changing its anchor. Persisted,
operator-arranged workspace geography would require a safe durable Observatory
identity for a host container and an explicit lifecycle policy; it is not
inferred from labels or added in this version.

### Ledger

Ledger provides a compact, grouped textual view over the same projection. It is
the accessibility and rapid-scanning counterpart to Atlas, not a separate state
model.

### Needs you

Needs you is a precise decision queue. Independent host, provider and repository
claims compose into one subject per Agent with supporting explanations.
Response, review, uncertainty and lifecycle decisions are ordered by human Goal
priority, decision type, waiting duration and observation recency.

### Catch up

Catch up summarises semantic change since the operator's last explicit
acknowledgement. It groups outcomes by System, Goal or Inbox rather than showing
an undifferentiated event stream. Polling and merely opening the panel do not
advance the checkpoint.

Metadata changes do not establish resolution: Agent summaries and counts retain
blocked/waiting or uncertain state until typed host evidence establishes recovery.
Historical transitions remain available even when a current summary is resolved.
Marking caught up acknowledges only the semantic and provider-evidence sequence
boundaries in the displayed projection, never changes that arrived afterward.
Older or repeated acknowledgements cannot regress either durable checkpoint.

### Inbox and Conversation history

Inbox contains accepted Agents that do not yet have a Goal. A recognized exact
Herdr execution is synchronized into Inbox automatically; provider catalogue
entries with no current host evidence remain Conversation history until an
operator adds them. Ambiguous or unidentified host executions remain in the
separate discovery surface. Confirmed-absent Agents leave the active Inbox and
Atlas projections without being deleted or archived. Discovered executions
have their own global count and section; they are not included in Inbox's Agent
count and are not hidden behind History.

### Inspector and review

The inspector explains accepted metadata, continuity, execution presence,
provider evidence and current capabilities. For a discovered execution it
additionally shows host-reported identity, freshness, safe workspace context,
conversation identification and whether exact catalogue admission is
available. Repository status and bounded working-tree review provide
verification context without exposing arbitrary filesystem access to the
browser.

### Multi-select filing

One Agent at a time is the reviewer's unit; several Agents at once is the
filer's. Agent multi-select exists so that organising a portfolio does not
require opening and re-filing each Agent individually, and it covers exactly one
durable effect: placement. A batch can receive a Goal, be placed directly in a
System, or be returned to Inbox.

Every Agent-rendering surface participates. A plain click keeps its existing
meaning, a `Cmd`/`Ctrl`-click toggles one Agent without disturbing the rest, and
a `Shift`-click replaces the selection with the range between the anchor and
the target. `Shift`-drag on the Atlas canvas marquees the covered cards instead
of panning; an unmodified drag still pans. `Cmd`/`Ctrl+A` selects every Agent
the current view shows, and `Shift` with the navigation keys extends the range.

Visible order has exactly one definition, shared by the navigator, Ledger and
Atlas gestures: each System contributes its Goals' Agents then its directly
placed Agents, and Inbox comes last. Filtering a view changes which Agents are
in that order, never the order itself, so Shift-click, Shift-arrow and the
marquee always walk the same sequence. A bulk gesture cannot reach an Agent the
operator cannot currently see, and a batch does not outlive the lens that shows
it: changing view, or an Agent leaving the projection, collapses the batch back
to its subject rather than leaving hidden Agents armed.

Focus is not a batch gesture. Keyboard focus keeps the inspector in step with
where the operator is, but it never reshapes an armed batch, so tabbing or
landing on a card's own quick actions cannot silently drop Agents the operator
deliberately selected.

With two or more Agents selected, the inspector replaces its single-subject
view with batch actions: the current placement summary, a bounded name preview,
and one explicit destination. Selection is staged and committed by a single
labelled action rather than applied on choice, so a batch move is always
confirmed and a selection spanning several Goals is legible before it is
executed. Assigning a Goal clears any direct System placement and returning to
Inbox clears both placements, exactly as the single-Agent path does; the
Universe still rejects archived Agents and archived Goals. Batch actions never
archive, close, complete, or otherwise end work.

Selection is transient renderer state, so a selected Agent that leaves the
projection is dropped before a command can span a stale id. Multi-select never
moves the camera or changes System scope: a batch is built in place, and only
an explicit plain click navigates. Pressing Escape collapses a batch to its
subject before a second Escape closes the inspector.

### Terminal deck

The terminal deck renders host-owned terminal streams. It preserves the Atlas
viewport while the operator inspects or interacts with an Agent. Previous/next
controls and a searchable picker switch directly among Agents with observed
executions. A discovered execution can open its own terminal, but it cannot be
silently renamed, assigned or switched into as a durable Agent before explicit
admission. Access is still validated freshly when a terminal opens. Linked
shell or sibling-Agent surfaces are transient host capabilities, not new durable
Agents.

## Primary workflows

### Orient

1. Open the Systems overview.
2. Enter the relevant System.
3. Read Goal geography, Agent load and attention aggregates.
4. Focus one Goal or switch to Ledger when density requires it.

### Triage

1. Open Needs you or jump to the next decision.
2. Inspect the explanation and supporting evidence.
3. Open the exact Agent, diff or terminal needed for judgment.
4. Return without reconstructing map context.

### Catch up

1. Open Catch up after time away.
2. Review Goal-level changes and underlying transitions.
3. Investigate relevant results or uncertainty.
4. Explicitly acknowledge only after the summary has been consumed.

### Start or resume work

1. Choose Goal, workspace and supported harness.
2. Start a new provider conversation or resume one exact dormant conversation.
3. Show launch as pending until exact provider identity exists.
4. Bind the resulting Agent and apply its requested human assignment without
   creating a host-only phantom.

### Observe external work

1. Start a supported agent directly in Herdr.
2. Let the normal host refresh synchronize recognized exact identity into an
   Inbox Agent.
3. Inspect safe runtime and workspace evidence or open its validated terminal.
4. Leave ambiguous or unidentified executions in `Discovered in Herdr`, and
   explicitly admit them only after exact catalogue evidence becomes available.

### Review and close

1. Treat runtime or provider completion as evidence, not acceptance.
2. Inspect provider claims, repository state, diff and checks.
3. Decide whether to continue, accept, close or archive.
4. Revalidate and close the exact host execution before archiving a live Agent.
   Closing it directly in Herdr is reflected after confirmed host absence; a
   second close action is not required.

Goal archive does not stop execution. Archived Goals remain visible as context
containers while they have unresolved executions: live, conflicting, or unknown
with a retained execution reference. Only those exceptional Agents are shown;
confirmed-ended and never-observed work stays archived. The same exception
applies to archived Agents. Visible Goal/Agent counts include these exceptions.
Blocked and waiting work still leads to Respond; other live archived work has
an explicit lifecycle decision in Needs you. Unknown or conflicting evidence is
a Monitor item, never a claim of liveness. These records retain their names,
assignments and System scope through Atlas, Ledger, Inspector and freshly
validated SessionHost terminal access. No process is automatically stopped,
Goal unarchived, or Agent reassigned.

## Visual principles

Every visual property needs a supervisory meaning.

- Stable position communicates identity and context.
- Colour and steady markers communicate state and attention.
- Motion is optional and never the sole state encoding.
- Human priority remains distinct from transient urgency.
- Unknown and stale evidence remain visually distinct from healthy or absent.
- Labels reduce before cards overlap.
- Complete information remains available through keyboard-accessible supporting
  views.
- Delight must improve orientation or judgment rather than decorate activity.

## Success criteria

Atlas geography is workspace-first. Each fresh live host execution territory
is a labelled island containing a compact Agent grid, including territories
with only one Agent. Host-specific workspace grouping may combine linked
worktree workspaces into one island while preserving their execution bindings
and worktree facts. Goals are semantic overlays shown on Agent cards and used
to spotlight matching Agents across any number of islands; they are not spatial
bodies. Live or uncertain Agents without fresh context evidence remain visible
in a separately labelled workspace-less area, and discovered executions remain
a separate dock. Confirmed-absent execution records remain in durable history
but are omitted from the active map. Systems only filter this geography.

The spatial product is useful when operators can:

- explain a realistic portfolio after 24–72 hours away;
- identify every subject requiring judgment without opening every Agent;
- find named work and reach its context quickly;
- distinguish process completion from trustworthy integration readiness;
- supervise more concurrent work without more missed interventions; and
- use remembered geography rather than external notes to reconstruct purpose.

The strongest failure signal is that Atlas looks distinctive but Ledger or Herdr
remains consistently faster and more trustworthy for orientation.

## Evaluation

Compare Atlas and Ledger over the same synthetic and live portfolios. Test at
roughly 20–40 Agents first, then at higher density. Measure completion time,
errors, unnecessary Agent opens, missed decisions, confidence and whether
stable locations become meaningful after repeated use.

Dogfood with real work, but retain only synthetic or sanitised evidence in the
repository.

## Scope boundaries

Observatory is not:

- an agent runtime, planner or autonomous dispatcher;
- a terminal multiplexer or general process supervisor;
- a transcript ingestion or universal chat product;
- a complete Git client;
- a repository/worktree project hierarchy;
- a remote or multi-user control plane;
- an automatic completion, merge or archive system; or
- a decorative 3D activity visualisation.

## Open product questions

- At what density does Goal geography stop aiding spatial memory?
- Which typed relationships improve supervision without turning Atlas into a
  generic graph?
- What minimum evidence makes a reported result trustworthy enough to accept?
- Which provider facts are consistently available without transcript access?
- How much semantic-density control is needed before focus and Ledger are
  sufficient?
- What narrowly defined automation, if any, can preserve human trust?

## Docked workspace trial (2026-09-07)

The desktop workspace has a resizable navigation column (240px initially),
the Atlas or Ledger, and a resizable inspector column (360px initially).
Navigation holds system/goal/agent discovery, a separate discovered-execution
count/section, Inbox, Needs you and Catch up. Selecting a goal, Agent or
discovered execution locates it on Atlas and opens its inspector;
All work, Needs you and Unassigned are views of the same sidebar list. Needs
you retains system/goal context and includes unassigned agents requiring
attention. Unassigned agents are assigned through the existing inspector,
individually or as a batch selection.
Catch up is a separate centred modal action. With no selection,
the right column shows the current system overview.

The canvas owns only the remaining column width; panels do not require guessed
camera reservations. Panel widths and the navigation preference live in browser
storage, never Universe state. Focus map sits beside the Atlas zoom/Fit controls and
temporarily hides both panels. Below 1200px the
navigation defaults to collapsed; below 700px the inspector also defaults to
collapsed. Explicitly opened narrow-screen panels overlay the canvas one at a
time. Resize separators support pointer dragging and keyboard arrows/Home/End.

The left navigator uses aligned attention action badges,
indented System/Goal/Agent rows, provider marks and accessible agent status
indicators. Only the selected item receives the full selection highlight;
additional members of a batch are marked as a distinct set, and the inspector
subject remains identifiable within it.

The navigator and system inspector avoid repeating portfolio metrics. Empty
list views show a short message. Catch up uses native modal
focus containment, Escape/backdrop dismissal and focus return to the trigger.
