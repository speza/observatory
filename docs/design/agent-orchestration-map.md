# Goal-centred agent orchestration map

Status: implemented V1 product model; spatial value under active evaluation
Updated: 2026-09-02

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
flat list. Its durable geography is `System → Goal → Agent`. Atlas is the
primary proof surface; Ledger, Needs you, Catch up, Inbox, inspector, workspace
review and terminals are supporting lenses over the same trusted state.

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

### Goal

A Goal is a durable human intention within a System. It owns priority,
completion, archive, accepted map position and direct Agent assignments. Goal
lifecycle remains human-controlled.

### Agent

An Agent is a durable, exactly identified provider conversation. It may have a
current host execution, a previous execution, no execution, or conflicting
execution evidence. Process and host lifecycle never replace conversation
identity.

### Supporting facts

Repository, branch, worktree, host, execution container, provider activity,
pull request and checks are evidence attached to an Agent. They support review,
search and related-work proposals but do not become map hierarchy.

## Authority and uncertainty

Observatory separates accepted semantic state from observed facts.

- Humans own Systems, Goals, assignment, priority, completion and archive.
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

- Systems provide broad portfolio scope.
- Goals are stable bodies in world space.
- Direct Agents occupy deterministic satellite positions around their Goal.
- Manual Goal movement pins the accepted position.
- Adding unrelated work does not globally reflow existing geography.
- An unpinned Goal may move locally when its own expanded footprint collides.
- Attention changes emphasis and navigation, not durable position.
- Repositories, runtimes and hosts never become spatial parent nodes.

Space must carry semantic value. If operators consistently choose Ledger or a
host sidebar to orient, the Atlas hypothesis has failed regardless of visual
appeal.

## Product surfaces

### Systems overview

The entry view summarises broad Systems by Goal and Agent load, current work and
Needs-you count. Entering a System reveals its Atlas or Ledger.

### Atlas

Atlas shows Goal bodies and their direct Agent satellites. It is designed for
orientation, relationship memory and navigation rather than full text
legibility for every card at every scale.

Geometric zoom changes camera scale. Presentation density changes labels and
metadata while preserving positions. Selected and attention-bearing work retain
identity at low density. Focus mode shows one complete Goal orbit when the full
portfolio is too dense.

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

### Inbox and Conversation history

Inbox contains accepted Agents that do not yet have a Goal. Conversation history
is a supporting catalogue of older provider conversations that are not active
Observatory Agents. Exact-live and newly observed conversations are admitted
automatically; older dormant history requires an explicit add action.

### Inspector and review

The inspector explains accepted metadata, continuity, execution presence,
provider evidence and current capabilities. Repository status and bounded
working-tree review provide verification context without exposing arbitrary
filesystem access to the browser.

### Terminal deck

The terminal deck renders host-owned terminal streams. It preserves Atlas
selection and viewport while the operator inspects or interacts with an Agent.
Linked shell or sibling-Agent surfaces are transient host capabilities, not new
durable Agents.

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
4. Admit and assign the resulting Agent without creating a host-only phantom.

### Review and close

1. Treat runtime or provider completion as evidence, not acceptance.
2. Inspect provider claims, repository state, diff and checks.
3. Decide whether to continue, accept, close or archive.
4. Revalidate and close the exact host execution before archiving a live Agent.

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
