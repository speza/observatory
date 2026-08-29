# Agent and linked execution model

Status: accepted implementation model
Date: 2026-08-24
Related: [Goal-centred agent orchestration map](../design/agent-orchestration-map.md),
[Contextual linked execution surfaces](contextual-companion-surfaces.md),
[Observatory technical architecture](../design/technical-architecture.md),
[Provider-session continuity and execution recovery](provider-session-continuity-and-recovery.md)

## Decision

The durable Observatory unit is an **Agent**. A host execution is a runtime
location owned by `SessionHost`; it is not a second product identity.

```text
Goal
└── Agent*
    ├── provider session?       durable continuity
    ├── current execution?      replaceable host binding
    └── linked executions*      transient supporting surfaces
```

An Agent is the worker a person supervises. A linked execution is a shell or
sibling agent surface that the host can expose in the context of that Agent.
Observatory does not own the process, PTY or Herdr topology.

## Durable model

`UniverseState.agents` is the authoritative durable inventory of accepted
agent work. Each Agent receives one stable Observatory `AgentId`. For supported
managed harnesses, an exact provider-session binding preserves continuity while
host execution bindings are replaced. Host kind and opaque native execution
identity locate a process; they do not identify the durable Agent.

Goals assign directly to Agents:

```text
Goal 1 ── contains ──> 0..n Agents
Agent  ── assigned to ──> 0..1 Goal
```

The existing human-controlled assignment, archive, attention and map-position
rules retain their meaning. The database is intentionally a fresh schema with
`agents` and `related_agent_dismissals`; no compatibility reader or migration
from the earlier session-shaped schema is required.

## Host model

`SessionHost` remains the only host seam. Herdr and future hosts own process
lifecycle, panes, terminals and attachment mechanics. Agent-harness plugins own
provider command construction, native resume and conversation continuity. They
report generic observations and capabilities; Herdr and provider identifiers
remain opaque outside their respective adapters. See
[Agent harness plugins](agent-harness-plugins.md).

`HostSnapshot.agents` is the host's authoritative recognised-execution
inventory. It does not define the durable provider-session catalogue.
Shell-only panes are not inserted into `UniverseState.agents`. When a durable
Agent is accessed through a current execution binding, the host may return
transient `LinkedExecution` values:

```text
HostSnapshot.agents
  ├── recognised agent execution -> Universe Agent
  └── linked execution access -> shell or sibling-agent surface
```

Each linked execution has:

- `kind`: `shell` or `agent`;
- an opaque owner target identifying its parent host Agent;
- a host-owned label and optional working directory;
- an opaque terminal target and adapter-owned identity binding when available; and
- an `observed` or `prepared` source plus an explanation.

The capability list is N-sized. The web GUI presents a picker for all available
linked executions and opens selected entries as companion tabs beside the
primary `Main` terminal.

Host snapshots continue while terminal surfaces are open. A picker refresh
revalidates its owner and replaces its rows from the latest host capability; it
closes only when no valid linked target remains.

## Shell-to-agent promotion

Promotion is observational. The person opens a linked shell and starts Claude,
Codex, Pi or another supported agent. On a later host snapshot, the host's
recognised-execution inventory includes that execution. Reconciliation then
waits for exact provider identity or explicit human acceptance before creating
or rebinding the normal Agent. It does not create a duplicate shell-derived
identity.

```text
linked shell
  -> person starts an agent in it
  -> host reports a recognised execution
  -> provider identity is observed or remains unknown
  -> Universe accepts or rebinds only with exact evidence or human intent
```

Missing or ambiguous provider or host facts remain uncertain observations. A
shared worktree or execution-container match may support a related-agent
projection, but it never silently assigns an Agent to a Goal.

## Interaction

- The map renders durable Agents as selectable satellites around Goals.
- Selecting an Agent exposes linked executions in its inspector and menu.
- The user can open a linked execution entirely inside Observatory.
- More than one linked execution opens a labelled picker; the user chooses the
  shell or sibling Agent to inspect.
- The selected Agent and map context remain intact while terminal tabs run.
- Selecting another Agent releases the old primary and companion terminal
  sessions.
- A linked execution that becomes recognised appears as its own Agent node after
  reconciliation; it is never duplicated as a durable linked-execution node.

The map remains the navigation surface. Terminal streams are transient
presentation surfaces, not map topology.

## Non-goals

- Observatory-owned process or PTY lifecycle.
- A general-purpose multiplexer or arbitrary nested split tree.
- Automatic Goal assignment from shared host context.
- Treating every shell pane as an Agent before the host recognises it.
- Native diff/review rendering; users can run their preferred tool in a linked
  shell.
