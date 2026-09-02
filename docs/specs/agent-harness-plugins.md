# Agent harness plugins

Status: implemented and live-validated

Updated: 2026-09-02

Depends on:

- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Agent launch and workspace preparation](session-launch.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)

## Why

Observatory must control which coding-agent CLI is started and which native
conversation is resumed. Herdr is the first execution host: it owns durable
terminal surfaces, PTYs, attachment, input, resize, scrollback and process
placement. It must not also be the place where Observatory defines Claude
Code, Codex, OpenCode, Pi or another harness's command syntax and session
semantics.

The previous transitional `SessionHost.listLaunchOptions` and Herdr
`agentKind` launch path have been removed. Harness packages now advertise and
construct lifecycle plans, while the host only executes a structured process
plan.

## Decision

> **Conversation-first amendment, 2026-08-31:** harness provider conversations
> now anchor durable Agent identity. Host observations are optional execution
> bindings and cannot create a managed Agent without exact conversation
> evidence. The normative model is
> [Conversation-first Agent tracking](conversation-first-agent-tracking.md).

Add an `agent-harness` capability to the contributed plugin system. A harness
plugin is the authority for one coding-agent CLI's lifecycle semantics. It
produces structured launch plans; it does not own the PTY or spawn outside the
selected `SessionHost`.

```text
StartAgentCoordinator
      |
      +--> WorkspaceProvider.prepare
      |
      +--> SessionHost.snapshot
      |             |
      |             v
      |       host facts and optional
      |       agent-aware evidence
      |
      +--> AgentHarness.proveContinuity
      |             |
      |             +--> already restored: reconcile only
      |             |
      |             +--> absent: planStart / planResume
      |             |
      |             v
      |       structured process plan
      |             |
      +--> SessionHost.launchExecution
                    |
                    v
           Herdr workspace / pane / PTY
                    |
                    v
          fresh host observation
                    |
      +--> AgentHarness.proveContinuity
      |
      +--> Universe reconciliation
```

The split is deliberate:

- `AgentHarness` knows what command and native session mean.
- `SessionHost` knows where and how the process runs and may report stronger
  agent-aware evidence when the host supports it.
- `StartAgentCoordinator` owns ordering, idempotency and failure recovery.
- `Universe` owns accepted Goal and Agent meaning.

Herdr is therefore more than a lowest-common-denominator multiplexer. Its
semantic agent state, native session references, automatic restore, event
stream and safe wait primitives make it the privileged V1 `SessionHost`. Those
features are preserved behind optional generic capabilities and observations.
They do not make Herdr the authority for provider command syntax, exact resume
rules or Observatory recovery policy.

## Ownership and capability model

The boundary is defined by who can make each decision:

| Concern                                                   | Owner                     |
| --------------------------------------------------------- | ------------------------- |
| New versus resumed native conversation                    | `AgentHarness`            |
| Provider executable, arguments and exact resume reference | `AgentHarness`            |
| Workspace preparation                                     | `WorkspaceProvider`       |
| Process placement, PTY, terminal access and close         | `SessionHost`             |
| Host-assisted restore and agent-aware runtime evidence    | `SessionHost` observation |
| Whether evidence proves continuity                        | `AgentHarness`            |
| Rebinding a durable Agent and preserving Goal assignment  | `Universe` command        |
| Recovery ordering, deduplication and retry                | coordinator               |

A host capability may improve fidelity without becoming required by every
host. Herdr can report semantic runtime state, an opaque native-session
reference, whether it restored an occupant, and event-driven changes. A future
tmux adapter may provide only process and pane observations, or enrich them
through hooks. Missing capability remains `unknown`; core never invents an
equivalent fact.

The minimum host change is one provider-neutral `launchExecution` operation
plus optional evidence in snapshots. Host-assisted restore is observed rather
than commanded: the coordinator snapshots first, then avoids launching a
duplicate when the harness proves that Herdr already restored the conversation.

## Required harness interface

The interface is small because each adapter should hide provider-specific
commands, hooks, filesystem conventions and version differences.

```ts
interface AgentHarness {
  readonly harnessId: string;
  describe(): AgentHarnessDescriptor;
  availability(): Effect<HarnessAvailability, HarnessError>;
  snapshotSessions(): Effect<ProviderSessionSnapshot, HarnessError>;
  planStart(request: StartHarnessSessionRequest): Effect<AgentProcessPlan, HarnessError>;
  planResume(request: ResumeHarnessSessionRequest): Effect<AgentProcessPlan, HarnessError>;
  proveContinuity(request: ContinuityRequest): Effect<ContinuityResult, HarnessError>;
}
```

Every production harness must implement:

1. **Availability** — detect the executable, supported version and required
   integration health without installing or upgrading anything silently.
2. **Catalogue** — report a scoped metadata-only provider-session snapshot.
   Partial or bounded snapshots must never claim complete absence.
3. **Start** — construct a structured executable, argument and environment
   plan for a genuinely new native conversation.
4. **Resume** — construct a structured plan for one exact native conversation;
   missing, stale or invalid references fail closed rather than falling back to
   "latest" or silently starting fresh.
5. **Continuity proof** — decide whether a fresh observation is the same native
   conversation, a replacement, absent or unknown. A pane, PID, working
   directory, provider label or agent name alone is insufficient proof.

New-session identity is provider-owned. `planStart` must not allocate or force a
native conversation identifier merely to make continuity synchronous. A
provider may return an identifier from a structured launch API, but interactive
CLIs such as Claude Code and Codex normally report their generated identifier
after process start. The launch remains execution-bound with unknown continuity
until that observation arrives.

`AgentProcessPlan` is serializable and contains an executable plus argument
array, bounded environment additions, working-directory policy and redaction
metadata. It is never a shell command string. Prompts, credentials and native
session references must not appear in diagnostics or launch traces.

The native conversation reference remains an opaque, namespaced value outside
the harness plugin. Observatory may persist it as sensitive local metadata for
continuity, but the Universe and renderers never interpret its provider-specific
shape or turn it into topology.

## Host evidence contract

`HostAgentObservation` may carry bounded, provenance-bearing evidence without
exposing a Herdr pane or provider payload:

```ts
interface HostHarnessEvidence {
  readonly detectedHarnessId?: string;
  readonly nativeConversationRef?: OpaqueNativeConversationRef;
  readonly restoreState?: "host-restored" | "not-restored" | "unknown";
  readonly source: "native-integration" | "hook" | "process" | "unknown";
  readonly observedAt: number;
}
```

The exact type may be narrowed during implementation, but these invariants are
fixed:

- the host adapter may extract and normalise evidence, but never interprets it
  as accepted continuity;
- core compares or stores opaque values only and does not parse provider
  formats;
- the harness decides whether the evidence is sufficient for `same`,
  `replaced`, `absent` or `unknown`;
- weak hints such as process name, current directory or display name cannot
  become native conversation proof; and
- evidence and references are redacted from ordinary diagnostics and fixtures.

Herdr's native agent-session reference is the first strong evidence source.
The mock host supplies deterministic equivalents. A future host that cannot
produce strong evidence remains useful for terminals and live discovery, but
cannot silently preserve semantic identity across a cold restart.

### Provider-owned identity observations

Hooks are one observation strategy, not a mandatory harness feature. Claude
Code and Codex lifecycle hooks expose their provider-generated session id. A
host-local integration may translate those events into `HostHarnessEvidence`
for the execution surface that emitted them. The identity reporter should run
on session start or resume and on at least one recurring lifecycle event so a
missed startup report can repair itself on the next interaction.

Other harnesses may instead obtain identity from a structured launch result,
provider API, structured session-list command or native host integration. A
provider-owned catalogue may also rediscover dormant sessions independently of
any host. When none exists, exact continuity remains `unknown`; process names,
paths and newest-file guesses are not substitutes.

Hook delivery is asynchronous and lossy. It accelerates reconciliation but
does not bypass a fresh host snapshot, write the Universe directly or turn
provider status into accepted semantic state. Hook registration and transport
belong at the capability edge and must remain replaceable by a remote
site-local observation sink later.

## Durable Agent identity and execution binding

The current `(hostKind, nativeId)` identity is transitional because it makes a
durable Observatory Agent equal to a current host pane. The target model keeps
the Agent stable while its execution binding changes:

```ts
interface Agent {
  readonly id: AgentId;
  readonly harnessId?: string;
  readonly nativeConversation?: OpaqueNativeConversationRef;
  readonly execution?: {
    readonly hostKind: string;
    readonly nativeId: string;
    readonly hostLocator?: string;
  };
}
```

These are metadata fields, not new topology. The final persistence shape may
use a separate binding record to keep sensitive references isolated, but it
must support these reconciliation rules:

1. A proved native conversation rebinds the existing Agent even when its host
   target changed.
2. A known host target now containing a different native conversation marks
   the old Agent interrupted/replaced; it does not inherit the old Goal.
3. An unproved observation after a cold restart remains unknown and enters the
   discovery/inbox path rather than taking over a durable Agent.
4. Goal assignment survives only a proved continuation or an explicit human
   rebind.
5. Runtime state and continuity are separate: a running process can still have
   unknown identity, and a proved conversation can still be interrupted.

## Optional capabilities

Additional operations are capability-gated and added only when at least one
real workflow needs them:

- fork a native conversation;
- provider-native activity, human-input requests, turn outcomes and context
  pressure through the versioned metadata-only observation source specified in
  [Provider-native Agent observations](provider-native-agent-observations.md);
- provider-native title, model and usage facts not covered by that source;
- bounded transcript or result inspection;
- provider-native prompt submission, attachments or permission responses;
- compaction or checkpoint controls; and
- integration setup diagnostics.

Terminal input, interrupt, resize, scrollback, native handoff and process close
remain `SessionHost` capabilities. A harness plugin must not duplicate them.
There is no universal chat or attachment interface hidden inside the required
contract. Observation is read-only and remains operational evidence: it cannot
complete an Agent or Goal, approve a request, substitute for checks or write
SQLite directly.

## Discovery and progressive support

Harness plugins discover provider-owned conversations, including dormant
conversations with no process. Session hosts discover current executions.
`ConversationTracker` canonicalises exact provider aliases and submits both
observation kinds through the one Universe observation interface.

Directly launched executions without exact provider conversation identity
remain diagnostic host evidence. They are not durable managed Agents and
cannot be manually promoted through cwd, title or recency.

Provider conversations remain in Conversation history until the operator adds
them explicitly. Exact liveness, recency and first-observed time do not create
Agents. A proven Observatory-managed new launch is the only non-history path to
admission. Provider facts never overwrite human-authored Goal assignment,
priority, completion, archive or naming.

Harness plugins do not receive concrete Herdr payloads. `SessionHost` exposes
only generic execution observations and opaque provider/session evidence it can
prove. The harness interprets provider evidence; Herdr identifiers and command
names remain inside `hosts/herdr/`.

## Cold restart recovery

After a machine or host restart:

1. load accepted Observatory state and mark pre-restart execution facts
   unknown;
2. reconnect the provider instance and refresh its declared catalogue scope;
3. start or reconnect the selected `SessionHost`;
4. take fresh provider and host snapshots before launching anything;
5. join only exact scoped conversation evidence;
6. rebind proved live continuations;
7. mark confirmed provider sessions with no execution dormant and offer resume
   only on proven eligible destinations; and
8. leave unavailable, failed or ambiguous observations unknown until a human
   chooses a recovery action.

The coordinator never starts a second process when the host has already
restored the same conversation. Resume does not imply that an interrupted turn
completed, and Observatory never silently sends "continue" after a restart.

The recovery decision table is:

| Fresh evidence                                     | Result              | Automatic action                                 |
| -------------------------------------------------- | ------------------- | ------------------------------------------------ |
| Same native conversation is live                   | proved continuation | rebind and reconcile                             |
| Known conversation is absent and exactly resumable | dormant/resumable   | offer resume                                     |
| Previous host target contains another conversation | replaced            | preserve old Agent; report untracked replacement |
| Evidence is weak, missing or contradictory         | unknown             | do not launch or reassign                        |
| Provider or host unavailable                       | unavailable/unknown | preserve durable state and retry observation     |

## Plugin package contract

`agent-harness` is declared in `observatory.plugin.json` and returned during
normal plugin activation. Built-in and third-party harnesses use the same
registry and contract tests. The plugin context remains trusted and in-process
for V1, but it receives neither the Universe, SQLite connection, concrete
`SessionHost` nor renderer.

The registry exposes descriptors and exact-id lookup through one small
read-only interface. The launch coordinator chooses a harness by stable
`harnessId`; callers and renderers never import a concrete adapter.

## Contract tests

Every production harness adapter must prove:

- unavailable, unsupported-version and unhealthy-integration reporting;
- new-session planning without accidental resume;
- exact-session resume without fallback to a fresh or latest conversation;
- same, replaced, absent and unknown continuity outcomes;
- structured argument handling and diagnostic redaction;
- behaviour when the executable exits, the host disappears or observation is
  delayed; and
- no transcript contents, credentials or private host data in fixtures.

A synthetic harness plugin exercises the full coordinator and cold-restart
path without installing a real provider CLI. Claude Code and Codex should be
the first two real adapters because they prove that the interface handles
different native resume command shapes.

## Implementation record

Each phase has a usable evidence gate. The transitional path remains only as
long as needed to keep `main` working; new harnesses must not extend it.

### Phase 0: recovery contract (implemented)

- Add synthetic fixtures for fresh start, exact resume, Herdr-style automatic
  restore, replacement in the same host target and ambiguous cold restart.
- Add coordinator-level acceptance tests proving no duplicate launch and no
  silent Goal inheritance.
- Record current SQLite identity assumptions and a clean-break reset fixture
  before changing the schema.

Gate: the scenarios are executable as contract inputs, the current limitations
are recorded as characterization evidence and `main` remains green. Each later
phase promotes the relevant scenario to a passing acceptance assertion.

### Phase 1: harness plugin seam (implemented)

- Add `agent-harness` to the plugin manifest and SDK capability union.
- Add `AgentHarness`, request/result, process-plan, opaque-reference and error
  types to `src/plugin-sdk/`.
- Extend the registry with descriptor listing and exact `harnessId` lookup.
- Add a synthetic harness and shared contract suite; plugin activation remains
  transactional and in-process.

Gate: two synthetic harness implementations pass the same contract without
importing host or Universe modules.

### Phase 2: provider-neutral host launch (implemented)

- Add `launchExecution(AgentProcessPlan)` to `SessionHost` and its mock.
- Add optional `HostHarnessEvidence` to host observations.
- Translate Herdr's agent-session metadata and restore state into bounded
  evidence while keeping Herdr payloads inside `hosts/herdr/`.
- Remove the old `launch`/`listLaunchOptions` path rather than retaining a
  second compatibility seam.

Gate: the mock and Herdr adapters pass the shared `SessionHost` contract, and a
generic process plan can be launched without a provider name in the host API.

### Phase 3: separate Agent identity from execution binding (implemented)

- Add durable harness/conversation identity and replaceable execution-binding
  persistence in a clean-break schema.
- Change reconciliation to apply the five identity rules above.
- Mark saved runtime facts unknown on process start until a fresh host snapshot
  supplies evidence.
- Keep native conversation references sensitive and out of projections unless
  a bounded capability explicitly needs them.

Gate: a durable Agent keeps its Goal across a proved target change, while a
replacement or ambiguous observation cannot inherit that Goal.

### Phase 4: first production harnesses (implemented)

- Add built-in Claude Code, Codex and Pi plugins with availability, new-session,
  exact-resume and continuity implementations.
- Encode executable/version differences inside each adapter, not in callers.
- Use Herdr evidence when present; remain correct when only the process plan and
  later observation are available.
- Add Pi after the first two adapters prove the interface; keep its TypeScript
  extension and session-file catalogue behind the same harness contract.

Gate: each real adapter passes the shared harness contract with sanitised
fixtures, including invalid references and exact-resume failure.

### Phase 5: coordinator and browser cutover (implemented)

- Inject the harness registry into the composition root and launch coordinator.
- Source launch choices from available harness descriptors rather than
  `SessionHost.listLaunchOptions`.
- Replace `agentKind` in the web launch intent with stable `harnessId`.
- Snapshot before launch, execute the plan, snapshot again and prove identity
  before assigning the Agent.
- Remove the current display-name/provider/worktree matching heuristic; use a
  launch receipt plus continuity proof.
- Persist or otherwise durably deduplicate launch request receipts so an AO
  process restart cannot replay a launch blindly.

Gate: the maintained web flow launches and assigns both real harnesses through
the registry, with duplicate-request and delayed-observation coverage.

### Phase 6: explicit restart recovery (implemented)

- Run the cold-restart sequence at composition-root startup and host reconnect.
- Surface `restored`, `resumable`, `replaced`, `unknown` and `host unavailable`
  without presenting inference as fact.
- Add an explicit Resume action that names the exact Agent and conversation;
  never auto-send a prompt after restoration.
- Verify that Herdr automatic restore is accepted without a duplicate launch.

Gate: restart AO, restart Herdr and restart the machine-equivalent test fixture;
in every case the operator sees the correct state and no duplicate process.

### Phase 7: transitional coupling removal (implemented)

- Delete `SessionHost.listLaunchOptions`, `HostLaunchRequest.agentKind` and
  provider command construction from `hosts/herdr/`.
- Delete compatibility mappings from the web protocol and update the
  architecture diagrams and extension guide.
- Confirm no core, persistence, projection or renderer module imports a
  concrete harness or Herdr type.

Gate: adding a third synthetic harness changes only its plugin package and
registration/configuration; a minimal synthetic host executes plans without
changes to Universe, persistence, projection or renderer modules.

### Phase 8: live validation (complete baseline)

- Smoke new and resumed Claude Code and Codex sessions on real Herdr.
- Exercise Herdr automatic restoration, agent replacement, unavailable CLI,
  stale reference, delayed observation and terminal handoff.
- Run `bun run format`, `bun run check`, `bun test` and the documented live
  Herdr smoke path before removing the transitional flag.

Gate: document the evidence and only then change this spec's status to
implemented.

Run the guarded live path with installed Herdr Claude and Codex integrations:

```sh
bun run smoke:herdr-harness
```

The script uses a disposable database and launches from the current trusted
repository with Claude plan mode and Codex's read-only sandbox. For deterministic
automation it disables Codex's startup update prompt and bypasses hook trust only
for the already-installed, inspected Herdr hook; production launch plans do not
add either override. It exactly resumes both harnesses, simulates an Observatory
process restart, checks host terminal capability, tracks its opaque execution
references for cleanup, and does not read transcripts or attach to existing
Agents.

## Implementation evidence

The implementation provides:

- one versioned `AgentHarness` plugin contract and registry, with Claude Code,
  Codex and an external-style example harness using the same activation path;
- provider-neutral `SessionHost.launchExecution`, implemented by the mock and
  Herdr adapters under shared host contract tests;
- durable Agent identity separated from replaceable execution binding, with a
  clean-break SQLite schema and cold-start invalidation;
- strong native-conversation reconciliation for restored, moved and replaced
  executions, while weak post-restart evidence creates an unassigned Agent;
- durable atomic launch receipts that prevent replay after an Observatory
  process crash or restart;
- exact resume through the coordinator and web API/UI, with no
  latest-session fallback; and
- projection redaction that keeps native conversation references out of
  renderer and browser contracts.

Deterministic coverage includes fresh start, exact absent resume,
host-restored resume without duplicate launch, target replacement, ambiguous
cold restart, durable request replay, request-id conflict, schema reset,
plugin collision and provider diagnostic redaction. The real-machine evidence
must record the installed Herdr integration status because exact Codex
continuity cannot be claimed from process or pane evidence alone.

Live validation on 2026-08-28 used current v7 Herdr integrations for Claude and
Codex. The combined guarded smoke proved `started -> exact resume -> proved`
for both harnesses across an Observatory restart simulation. It also exposed
the requirement that Agent close interrupts the interactive process before
removing the pane so Codex releases its single-writer lock. The final cleanup
check found no disposable smoke panes or processes.

The follow-up provider-identity change removes Observatory's Claude UUID
allocation and the Herdr adapter's synthetic `report-agent-session` call.
Claude Code and Codex now own new-session IDs; installed lifecycle integrations
report them asynchronously. Exact resume still carries the already-observed
provider reference in the harness-owned process plan.

## Completion criteria

This migration is complete only when:

- Observatory can start and exactly resume Claude Code and Codex through
  harness plugins without Herdr constructing either command;
- a new harness requires no edit to `hosts/herdr/`, Universe, persistence,
  projections or renderers;
- a host may omit agent-aware evidence without violating the contract, while
  Herdr's stronger evidence and automatic restore are still used;
- machine/Herdr/AO restart paths never duplicate a proved live conversation or
  silently transfer Goal ownership;
- durable Agent identity survives a proved execution-target change;
- ambiguous continuity is visibly unknown and requires human action; and
- deterministic contracts plus the real Herdr smoke path cover new, resumed,
  restored, replaced and unavailable cases.

## Rejected alternatives

- **Keep provider launch knowledge in Herdr.** This makes every new harness a
  host change and prevents the same lifecycle implementation running on a
  future host.
- **Treat Herdr as a dumb tmux replacement.** This throws away strong session
  evidence and automatic restore that materially improve recovery.
- **Create a universal provider/chat API.** Start, exact resume and continuity
  are the proven common lifecycle; richer controls remain optional.
- **Use transcript parsing as identity.** It is privacy-sensitive, ambiguous
  and unnecessary when native references exist.
- **Trust pane identity after restart.** A restored pane may contain a
  replacement process, and a native conversation may move to another pane.
- **Always issue resume on startup.** Herdr may already have restored the exact
  conversation, so this risks duplicate processes and turns.

## Non-goals

- Rebuilding Herdr's multiplexer, PTY or terminal transport.
- Letting plugins write Universe state or SQLite directly.
- Requiring transcript ingestion for start, resume or continuity.
- Automatically installing provider CLIs, hooks or credentials.
- Treating an LLM model vendor as the durable Observatory topology.
- Silently resuming interrupted work or claiming that it completed.
