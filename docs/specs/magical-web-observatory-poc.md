# Magical web Observatory POC

Status: closed — decisions promoted to the maintained local web walking slice
Date: 2026-08-25
Depends on: [Goal-centred agent orchestration map](../design/agent-orchestration-map.md),
[Observatory technical architecture](../design/technical-architecture.md)

## Why

Observatory's spatial hypothesis needs to prove more than aesthetic appeal. The
web POC asks whether a memorable Goal -> Agent geography helps an operator
understand concurrent work, catch up after an absence and move into useful work
more confidently than a strong list.

The POC exists to settle the visual and interaction contract before committing
to a production web client, transport, renderer or component architecture. It
is not production code and must not be promoted directly.

## Question

> Can the Mineral Atlas keep twelve Goals and seventy-five Agents legible,
> explain what changed while the operator was away, and preserve context through
> the transition from attention signal to execution surface?

The same in-memory fixture must also be available as a strong grouped ledger.
The Atlas passes only if it adds orientation, context or return memory rather
than merely looking more distinctive.

## Decisions already made

- Native SVG/CSS is the world renderer. PixiJS and the losing renderer variants
  were removed after native SVG remained sharper under pan and zoom.
- Mineral Ledger is the sole art direction. It uses an editorial cartographic
  language in light and dark themes rather than neon, glass or generic purple
  AI styling.
- The spatial Atlas is primary. The Attention Queue and grouped Ledger are
  supporting lenses over the same data.
- Full human-authored Goal titles sit outside planet bodies. Planet interiors
  contain only compact status facts.
- The prototype remains read-only and in memory.

## Validation fixture

The single fixture contains:

- twelve Goals with realistic multiword titles and stable positions;
- seventy-five Agents with deliberately uneven Goal membership;
- working, idle, waiting, blocked, done and unknown observations;
- unassigned Agents outside accepted Goal geography;
- active, completed and archived Goals;
- recent new, changed, finished and stale facts;
- long activity and attention text;
- parent/child delegation examples; and
- repositories, branches and synthetic attachment targets.

No fixture contains real transcripts, credentials or private host data.

## One coherent prototype

The route is:

```text
/prototype/observatory?theme=light
/prototype/observatory?theme=dark
```

It contains four connected experiments rather than separate art variants.

### 1. Truth-stress Atlas

The portfolio renders all twelve Goals and seventy-one assigned Agents. Labels
use semantic zoom and attention to avoid presenting every Agent name at the
portfolio level. Completed and archived Goals remain visible but visibly
secondary. Four unassigned Agents occupy a separate inbox.

Stable IDs and accepted positions do not change between scenario moments. The
test is whether the composition remains understandable under realistic density,
long titles and uneven Goal sizes.

### 2. Catch-up lens

**Catch up since 08:30** reveals an explicit summary of new, changed, finished
and stale observations. The map marks affected Goals and Agents without
rearranging geography. Every change remains written as text in the catch-up
brief or inspector; colour and motion are supplementary.

The operator should be able to answer:

- What changed?
- What finished?
- What needs judgment?
- What has become uncertain?
- Which result should be verified?

### 3. Operational handoff

Selecting an Agent and choosing **Open work surface** opens a simulated
read-only composition containing terminal context, proposed diff and result
evidence. Returning restores the selected Agent, focused Goal and exact Atlas
viewport.

This tests the product composition only. It does not create a PTY, terminal
protocol, host adapter or multiplexer. A production action would use the
injected generic `SessionHost` capability and keep Herdr details inside its
adapter.

### 4. Same-data Ledger

The Atlas/Ledger switch changes only presentation. The Ledger groups every
Agent by Goal, exposes operational counts, includes the unassigned inbox and can
apply the same catch-up facts. It is deliberately strong at scanning.

Compare the two using these tasks:

1. Find every item requiring human judgment.
2. Explain the purpose and current state of one busy Goal.
3. Identify what changed while the operator was away.
4. Find stale, unassigned, completed and archived work.
5. Open one Agent's work surface and return to the prior context.

Record completion time, misses, unnecessary selections and confidence. The
expected division of labour is that the Ledger wins rapid scanning while the
Atlas wins orientation, context and resumption. If the Atlas does not add that
value, it has not earned the production investment.

## Semantic contract

| Meaning              | Required behaviour                                    |
| -------------------- | ----------------------------------------------------- |
| Goal identity        | Stable position, mineral identity and full title      |
| Human priority       | Persistent treatment independent of runtime attention |
| Agent identity       | Stable marker and location relative to its Goal       |
| Working              | Written state plus restrained presence motion         |
| Waiting or blocked   | Steady attention signal with an exact reason          |
| Stale or unavailable | Explicitly uncertain with observation age             |
| Recent change        | Textual change fact without moving accepted geography |
| Completed/archived   | Human lifecycle remains visible and clearly secondary |
| Selected             | Focus preserves surrounding context and return state  |
| Unassigned           | Outside accepted Goal geography                       |
| Repository/worktree  | Inspector fact, never a world node                    |

## Accessibility and responsive gate

Before production integration, inspect common laptop and ultrawide sizes plus
200% browser zoom. Goal and Agent controls must support keyboard activation and
visible focus. State, attention, lifecycle and recent change cannot rely on
colour or animation. Reduced-motion mode stops ambient animation without
removing meaning. Day and Night maps must retain readable contrast.

This is not a complete WCAG conformance audit; it is the pre-integration gate
for composition and semantic encoding.

## Technical boundary

The POC lives under `prototypes/`, owns its disposable dependencies and starts
with one command. It does not read SQLite, contact Herdr or import production
Universe, projection or host modules.

Production integration must rewrite the chosen behaviour against an explicit
projection contract. Durable Goal state and accepted positions belong to the
Universe. Camera, hover, selection, catch-up presentation and work-surface
layout remain renderer state unless a separate product decision says otherwise.

Do not add a web server, daemon, persistence transport, real PTY or host-specific
API as part of this experiment.

## Exit criteria

Stop prototyping and write the integration design when:

- the Atlas remains legible at the agreed fixture density and browser sizes;
- catch-up facts answer the operator questions without animation or colour;
- Agent selection leads naturally to a useful work surface and returns without
  losing context;
- the same-data comparison establishes what the Atlas adds over the Ledger;
- every visible semantic fact has an identified future projection source; and
- V1's read-only versus command scope is explicitly decided.
