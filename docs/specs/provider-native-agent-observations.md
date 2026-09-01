# Provider-native Agent observations

Status: accepted design; local Claude Code, Codex and Pi reference reporters implemented

Date: 2026-08-30

Depends on:

- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Observatory plugin system](observatory-plugin-system.md)
- [Agent harness plugins](agent-harness-plugins.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Agent repository status and code-host plugins](agent-repository-and-code-host-plugins.md)

## Decision

Provider-native events enrich an Agent through an optional, versioned
observation source on its existing `AgentHarness`. They are operational
evidence, not commands and not semantic authority.

The first slice is metadata-only. It normalises current activity, requests for
human input, provider-reported turn outcomes and context pressure. It does not
ingest prompts, messages, transcripts, tool inputs or outputs, commands, raw
terminal output, credentials, or provider payloads.

```text
provider hooks / structured API / local metadata
                       |
                       v
          AgentHarness observation source
             Effect at the I/O boundary
                       |
                       v
       coordinator validates, correlates and stores
          bounded operational observations
                       |
         +-------------+--------------+
         |             |              |
         v             v              v
     attention      catch-up      inspector / verification
       deterministic projections over one snapshot

SessionHost ---------- process, PTY, execution and terminal evidence
workspace/code host -- diffs, checks, reviews and merge evidence
Universe/human ------- Goals, assignment, priority and accepted completion
```

This deepens `AgentHarness`; it does not add a `ProviderFactsService`, a
provider-specific core union, a generic event bus, or a second host seam. The
durable topology remains `System -> Goal -> Agent`.

## User workflows

Coarse host status answers whether an execution appears live and whether a PTY
can be opened. It cannot answer the daily supervision questions below:

1. **Who needs me now?** A process can be live while waiting at a permission,
   question or plan-approval prompt. Host `working` or `waiting` cannot identify
   why it waits or whether the provider requested a human decision.
2. **What changed while I was away?** Terminal presence cannot distinguish a
   response completing, an API failure, repeated tool work, compaction or a
   request that opened and was later resolved.
3. **Which Agent is safe to review?** A provider can report that a turn stopped,
   but only repository and code-host evidence can show a diff and checks, and
   only a human can accept Agent or Goal completion.
4. **Which Agent may degrade soon?** Provider context pressure can justify an
   attention hint before a compaction or handoff. Process presence cannot.
5. **What is unknown?** An unsupported provider, disabled hook or disconnected
   reporter must produce an explicit unavailable or stale enrichment state,
   not a misleading idle state.

The UI should answer these questions without opening every terminal, while
retaining a route to the terminal for provider-specific detail.

## Authority and evidence fusion

Observatory does not derive one omniscient Agent status. It retains evidence on
separate axes with source, time and health:

| Claim axis                                                           | Authority or evidence owner       |
| -------------------------------------------------------------------- | --------------------------------- |
| Goal, assignment, priority, archive and accepted completion          | Universe commands and humans      |
| Provider conversation identity and exact resume semantics            | `AgentHarness` / provider         |
| Process presence, execution lifecycle, PTY and terminal capabilities | `SessionHost`                     |
| Provider turn activity, requests, outcome and context pressure       | `AgentHarness` observation source |
| Working-tree changes and local checks                                | workspace/Git reader              |
| Pull request, CI, review and merge state                             | `CodeHostingProvider`             |

Precedence applies only to claims about the same axis and scope. A fresh exact
host observation can supersede an older host-presence claim; it cannot refute a
provider-reported completed response. A fresh provider outcome can close that
provider's activity claim; it cannot complete an Agent or Goal.

Apparently conflicting evidence is retained and projected, not silently
collapsed:

- live process + completed response means a live, idle conversation ready for
  another turn;
- absent process + fresh tool activity means a transport, identity or
  freshness conflict and blocks strong lifecycle claims;
- provider-reported completion + failing checks means review is required, not
  completion;
- an open permission request + unavailable host remains an unresolved request
  with uncertain reachability;
- missing or expired provider evidence means `unknown`, never `idle`, `done` or
  `no request`.

Each projection may explain the contributing claims and conflict. It must not
invent a cross-source timestamp ordering or choose a source merely because it
reported last.

## Plugin contract

`agent-harness` remains the manifest capability. A harness descriptor advertises
whether it provides the optional observation source. No new top-level
`provider-facts` capability is added.

The implementation should add the following serialisable sub-capability to the
plugin SDK. Its own schema version allows the observation vocabulary to evolve
without creating provider brands in core. Adding the optional member is
compatible with existing harnesses; any incompatible SDK change still follows
the plugin API major-version rules.

```ts
interface AgentHarness {
  // existing lifecycle and continuity methods
  observationSource?: AgentObservationSourceV1;
}

interface AgentObservationSourceV1 {
  readonly schemaVersion: 1;
  describe(): AgentObservationCapability;
  snapshot(
    request: AgentObservationSnapshotRequest,
  ): Effect<AgentObservationSnapshot, HarnessObservationError>;
}

interface AgentObservationCapability {
  readonly kinds: readonly AgentObservationKind[];
  readonly acquisition: "hook" | "structured-api" | "metadata" | "mixed";
  readonly delivery: "snapshot" | "retained-events-and-snapshot";
  readonly configured: boolean;
  readonly freshnessSeconds: Partial<Record<AgentObservationKind, number>>;
}

interface AgentObservationSnapshotRequest {
  readonly providerInstanceId: string;
  readonly afterCursor?: string;
  readonly limit: number;
}

interface AgentObservationSnapshot {
  readonly schemaVersion: 1;
  readonly harnessId: string;
  readonly providerInstanceId: string;
  readonly continuityScopeId: string;
  readonly capturedAt: number;
  readonly complete: boolean;
  readonly cursor?: string;
  readonly current: readonly AgentObservation[];
  readonly transitions: readonly AgentObservation[];
  readonly health: AgentObservationHealth;
}

interface AgentObservationHealth {
  readonly state:
    "unsupported" | "not-configured" | "healthy" | "stale" | "unavailable" | "degraded";
  readonly lastSuccessfulAt?: number;
  readonly diagnostics: readonly string[];
}
```

`current` always returns the latest retained claims in scope. `transitions`
returns bounded normalised transitions after the cursor, or the retained window
when no cursor is supplied; it is not a provider event dump. Polling at the
composition root is sufficient for the first slice. A future optional stream
may reduce latency only after two providers need it; it must carry the same
envelopes and must not replace snapshots or reconciliation.

`complete` is scoped to the source's declared retained state, not to facts the
provider never emitted. A partial snapshot cannot resolve an open request by
omission. The coordinator runs the Effect, validates bounds, correlates the
opaque conversation reference, deduplicates and writes through a kernel-owned
operational evidence repository. Plugins receive neither that repository nor
SQLite.

## Normalised observation vocabulary

Every observation has one common envelope:

```ts
interface AgentObservationEnvelope<TKind, TPayload> {
  readonly schemaVersion: 1;
  readonly observationId: string;
  readonly revision?: number;
  readonly nativeConversationRef: OpaqueNativeConversationRef;
  readonly providerInstanceId: string;
  readonly kind: TKind;
  readonly observedAt: number;
  readonly source: {
    readonly mechanism: "hook" | "structured-api" | "metadata";
    readonly providerVersion?: string;
  };
  readonly payload: TPayload;
  readonly extensions?: Readonly<Record<string, string | number | boolean | null>>;
}
```

The registry adds plugin id and receipt time as trusted ingestion provenance;
a plugin cannot claim another plugin id. `receivedAt` is diagnostic transport
time and never replaces `observedAt`. `extensions` keys are declared by the
harness and namespaced as `<plugin-id>/<key>`; the whole object is limited to
2 KiB, 16 keys and scalar values. Core does not filter, sort or trigger
attention from extension values.

The V1 union contains only four kinds:

```ts
type AgentObservationKind =
  "activity" | "human-input-request" | "turn-outcome" | "context-pressure";
```

### `activity`

```ts
interface ActivityObservation {
  readonly phase: "responding" | "using-tool" | "compacting" | "idle";
  readonly toolCategory?:
    "read" | "write" | "execute" | "search" | "network" | "delegate" | "other";
}
```

This powers an at-a-glance Agent label and catch-up transition without exposing
tool names, paths, queries or commands. `toolCategory` is present only for
`using-tool`. A provider event such as prompt submission may justify
`responding`; absence of such an event does not.

### `human-input-request`

```ts
interface HumanInputRequestObservation {
  readonly requestId: string;
  readonly requestKind: "permission" | "question" | "plan-approval" | "other";
  readonly state: "open" | "resolved" | "withdrawn";
  readonly toolCategory?: ActivityObservation["toolCategory"];
}
```

This powers immediate attention and resolution in catch-up. `requestId` is a
provider-stable identifier when available or a source-stable derived hash; it
contains no user-visible text. The payload never includes the question,
permission command, plan or candidate response. V1 directs the operator to the
host terminal to answer; responding through Observatory is a separate control
capability and is not specified here.

### `turn-outcome`

```ts
interface TurnOutcomeObservation {
  readonly turnId?: string;
  readonly outcome: "response-completed" | "failed" | "interrupted";
  readonly failureCategory?:
    | "rate-limit"
    | "authentication"
    | "billing"
    | "provider-overloaded"
    | "context-limit"
    | "tool"
    | "unknown";
}
```

`response-completed` means only that the provider ended a response or turn. UI
copy must say **Provider reported response complete**, never **Agent complete**.
Failures retain a coarse category and discard raw error text. A provider that
cannot distinguish interruption or failure omits the observation rather than
guessing.

### `context-pressure`

```ts
interface ContextPressureObservation {
  readonly usedRatio?: number; // finite, clamped to 0..1
  readonly compaction?: "started" | "completed";
}
```

This powers context-risk attention and inspector context. The kernel owns band
thresholds and derives `normal | elevated | critical`, so providers do not
choose attention severity. A provider may report only compaction when no
reliable ratio exists.

### Deliberate exclusions

- Conversation identity remains the existing provider-session continuity
  contract, not an observation kind.
- Token and cost usage are not normalised in V1. Claude status data, Codex
  thread usage and individual turn counters have different scopes and reset
  semantics; no accepted daily workflow yet depends on combining them. A
  later inspector-only `usage` kind requires two verified mappings with an
  explicit `turn | current-context | session` scope.
- Provider models, titles and native task/subagent graphs do not drive V1
  attention. Existing bounded catalogue display facts remain where they are.
- Raw provider event names and payloads are not extensions.

## Identity, time and recovery

### Correlation

An observation targets an exact
`(harnessId, continuityScopeId, nativeConversationRef)` and
`providerInstanceId`. The coordinator resolves that sensitive reference to an
accepted Agent server-side.

An unknown observation remains uncorrelated. It does not create, assign or
mutate an Agent. Only provider catalogue ingestion through `ConversationTracker`
may admit a new conversation or expose it in conversation history. Workspace,
cwd, title, process name and recency can rank catalogue entries but cannot
establish identity.

### Provenance and freshness

The stored record includes plugin id, harness id, provider instance, continuity
scope, mechanism, provider version when supplied, observed time, receipt time,
snapshot cursor and source health. Native references remain sensitive and do
not enter normal browser projections.

Freshness is per kind and bounded by kernel policy. A plugin may advertise a
shorter useful lifetime but cannot extend the kernel maximum. Expired activity
and context claims become unknown. An open human request remains visibly stale
until explicitly resolved/withdrawn or a complete snapshot for that exact
source scope proves it absent; a partial snapshot never closes it.

### Deduplication and order

- `observationId` is stable for one provider event or current claim. When the
  provider supplies no event id, the adapter derives a canonical hash from the
  safe normalised fields, exact scoped identity and provider correlation ids.
- Repeated `(source, observationId, revision)` is idempotent.
- `revision` orders updates only for that observation id. A cursor orders only
  one declared source stream. Neither is a global order.
- Wall-clock `observedAt` is used for age and explanation, not total ordering.
- A late lower revision cannot overwrite a newer claim. Non-comparable
  conflicting claims are retained until freshness or a complete snapshot
  resolves them.
- Catch-up is generated from reconciled state transitions, not every delivery
  retry.

### Missed events, loss and restart

Hooks are asynchronous hints. Matching handlers may run concurrently, async
handlers may finish out of order, processes can exit before delivery, and a
provider may not hook every tool path. Correctness therefore requires:

1. a bounded site-local outbox or source cache where the acquisition mechanism
   permits it;
2. idempotent polling with cursors;
3. a source snapshot after Observatory or plugin restart and after reconnect;
4. recurring safe provider events to repair identity/activity when available;
5. complete/partial scope on every snapshot; and
6. explicit stale/unavailable state when no repair source exists.

The kernel persists a bounded latest-state cache and enough transition history
for catch-up. After restart it can render saved evidence as stale while the
source reconnects, but it cannot call it fresh. Plugin disable, crash, upgrade
or removal leaves Goals, Agents, assignments and accepted completion intact;
enrichment becomes unavailable and naturally expires. Re-enabling reconciles a
fresh snapshot before clearing that state.

## Projection rules

The coordinator supplies an immutable `AgentEvidenceSnapshot` to pure
attention, catch-up and detail projection functions. Universe, spatial and
projection calculations remain Effect-free.

### Attention

V1 deterministic signals are:

| Evidence                                               | Signal                     |
| ------------------------------------------------------ | -------------------------- |
| fresh open permission/question/plan request            | human input required       |
| fresh provider turn failure                            | provider failure           |
| fresh response-completed, not superseded by newer work | provider review candidate  |
| context band elevated/critical                         | context pressure           |
| cross-axis conflict or expired open request            | observation conflict/stale |

Severity and ordering are kernel rules. Provider extensions cannot create
signals. A turn outcome describes one response, not Agent lifecycle: newer
provider activity or a newer fresh host observation of `working` supersedes an
older response-completed review candidate. The historical outcome remains in
Catch Up. Host `waiting` may corroborate an input request but is not required;
host and provider conflicts remain visible. All current claims for one Agent
compose into one operator-facing decision with supporting explanations, so
counts describe affected Agents rather than evidence volume.

### Catch-up

Catch-up records semantic transitions such as request opened/resolved, response
completed, failure, compaction and context entering a higher band. It coalesces
repeated activity/tool events and delivery retries. Checkpoint acknowledgement
remains an explicit human action; provider events cannot advance it.

### Inspector

The Agent inspector may show current safe activity, open request kind, reported
turn outcome, context band, source, age, capability and source health. It shows
**unsupported**, **not configured**, **unavailable**, **stale** and **unknown**
distinctly. It does not show raw event data, transcript paths, native references
outside the existing explicit local diagnostic allowance, or discarded fields.

### Verification and completion

The review projection keeps four independent columns:

1. provider-reported response outcome;
2. working-tree diff and independently executed local checks;
3. code-host pull request, CI, review and merge evidence; and
4. human acceptance of Agent/Goal completion.

No column fills another. `response-completed` can make work review-ready; it
cannot mark checks passed, infer a diff, complete a Goal or archive an Agent.
Provider-reported tool success is not an independently observed check.

## Privacy and security

### Data minimisation

Adapters translate at acquisition and discard disallowed fields before they
enter an outbox, log or plugin diagnostic. In particular they must discard:

- prompt, message, assistant response and question text;
- transcript paths and transcript contents;
- tool input, tool output, commands, patches, file contents and raw errors;
- credentials, environment values and authorization headers;
- raw terminal output; and
- provider notification text or arbitrary JSON payloads.

Diagnostics contain only bounded categories, provider version, capability
state, event kind, counts and timestamps. They are capped by the existing
plugin diagnostic boundary. Fixtures include sentinel secrets and transcript
text and assert that none crosses the source.

### Trust and authenticity

A local command hook runs with the user's permissions and is not a
cryptographically authenticated statement from the model provider. Its trust
comes from reviewed hook configuration, the provider-generated scoped session
id and a local authenticated transport. The UI labels its mechanism as a hook,
not as independently verified truth.

The preferred local sink is a user-only Unix socket. Loopback HTTP is allowed
with a per-install bearer secret, strict body/size limits, replay protection and
no CORS; it must never bind a public interface unauthenticated. Hook setup is
explicit and reviewable. Observatory does not silently rewrite provider
settings, bypass hook trust or weaken managed policy.

For remote sites, the reporter writes to a bounded durable site outbox and an
outbound connector authenticates the accepted site and provider instance using
a scoped token or mutually authenticated channel. Sequence/cursor replay is
idempotent. Do not expose a public hook endpoint or tunnel a raw Herdr socket.

An observation source is read-only. It cannot approve a permission, submit a
prompt, alter a tool call or issue terminal input. Those controls require a
separate explicit product and security decision.

## Configuration, lifecycle and health

Capability discovery distinguishes:

- `unsupported`: this harness/provider version has no source;
- `not-configured`: available but not enabled or trusted;
- `healthy`: a fresh snapshot succeeded;
- `stale`: the last safe snapshot exceeded policy;
- `unavailable`: configured source failed or disconnected; and
- `degraded`: only a declared subset of kinds or acquisition paths works.

`AgentHarness.availability` and plugin status include bounded setup diagnostics;
the observation descriptor carries kind-level support. A doctor/setup flow may
show the exact reviewed provider hook entry, required minimum version,
transport reachability and last safe receipt. V1 changes provider settings only
through the explicit operator-run installer and never bypasses provider trust
or managed policy.

Activation remains transactional. The source starts and stops with normal
plugin activation/disposal. A source failure degrades only provider enrichment,
not start, resume, catalogue, terminal or accepted semantic state. Core startup
and all normal supervision flows remain valid with no source.

## Reference mappings

The provider APIs below were checked against official documentation on
2026-08-30. Both products are versioned rapidly; setup must detect the installed
version, and fixtures must name the documented version. Documentation or a
`main`-branch schema is not proof that a field exists in the installed release.

### Claude Code

[Claude Code hooks](https://code.claude.com/docs/en/hooks) currently document a
common `session_id` and events including `UserPromptSubmit`, `PreToolUse`,
`PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`,
`PreCompact`, `PostCompact`, `Notification`, `SessionStart` and `SessionEnd`.
The adapter maps only safe metadata:

| Claude event/field                          | Normalised claim                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `session_id`                                | existing exact conversation identity                                              |
| `UserPromptSubmit`                          | activity `responding`; discard `prompt`                                           |
| `PreToolUse.tool_name`                      | activity `using-tool` with allowlisted category; discard input/name after mapping |
| `PreToolUse` for `AskUserQuestion`          | open question request; discard questions and choices                              |
| `PreToolUse` for `ExitPlanMode`             | open plan-approval request; discard plan and path                                 |
| `PermissionRequest.tool_name`               | open permission request with derived id/category                                  |
| matching `PostToolUse`, failure or turn end | resolve/withdraw request when safely correlatable; otherwise let it become stale  |
| `PostToolUse` / `PostToolUseFailure`        | activity transition; the latter may support coarse tool failure, not raw error    |
| `Stop`                                      | `response-completed` and activity idle; discard `last_assistant_message`          |
| `StopFailure.error`                         | failed with allowlisted category; discard details/message                         |
| `PreCompact` / `PostCompact`                | compacting / context compacted                                                    |
| `SessionEnd`                                | activity idle; not proof that the provider session was deleted                    |

`Stop` means Claude finished responding and does not fire for a user interrupt;
it is not semantic completion. `PermissionRequest` is the immediate permission
signal; `Notification.permission_prompt` is delayed and is only a fallback.
Notification types for background Agents are version-gated and do not replace
the exact lifecycle events.

The official
[status-line contract](https://code.claude.com/docs/en/statusline) exposes
`session_id`, `context_window.used_percentage`, current context counters and
session cost. A status-line integration could map the percentage to
`context-pressure`, but it competes with the user's configured status line and
can be null before the first response or immediately after compaction. This
requires a setup-composition spike; V1 must not replace an existing status line
silently. Cost and token fields remain excluded from V1 normalisation.

Claude documents that matching hooks run in parallel. Async hooks can arrive
late, and hook errors/timeouts commonly fail open. The first implementation
therefore needs snapshot/outbox and stale behavior; hook presence is not a
delivery guarantee.

### Codex

[Codex hooks](https://developers.openai.com/codex/hooks) currently document
`session_id`, turn-scoped `turn_id`, and `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`,
`Stop`, subagent and `SessionEnd` events. This proves the same vocabulary works
without a Claude-specific core type:

| Codex event/field             | Normalised claim                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `session_id` / `turn_id`      | existing conversation identity / optional turn correlation                                              |
| `UserPromptSubmit`            | activity `responding`; discard prompt                                                                   |
| `PreToolUse.tool_name`        | activity `using-tool` with category; discard input/name after mapping                                   |
| `PermissionRequest.tool_name` | open permission request with category                                                                   |
| `PostToolUse`                 | activity transition; non-zero Bash completion must be classified from safe structured status or omitted |
| `Stop`                        | `response-completed` and activity idle; discard assistant message                                       |
| `PreCompact` / `PostCompact`  | compacting / context compacted                                                                          |
| `SessionEnd`                  | idle; not session deletion                                                                              |

Codex does not currently document a distinct `StopFailure` hook. The hook
adapter therefore reports no turn failure unless a documented safe status
supports it; it must not parse assistant text or transcripts. Hosted tools and
some specialised tool paths are outside current tool-hook coverage. Matching
command hooks run concurrently, background hooks can complete out of order and
unfinished background hooks are cancelled at session end.

The documented Codex hook surface proves immediate permission requests but not
a generic user-question event. The app-server documents structured approval and
user-input requests; question and plan-approval claims therefore remain
unsupported in the CLI-hook source unless an installed release exposes a
documented, safely correlatable local tool event. The adapter must not infer
them from prompt or assistant text.

Codex's documented
[app-server protocol](https://developers.openai.com/codex/app-server) exposes
structured thread/turn lifecycle, approval requests, item progress and
`thread/tokenUsage/updated` over its active JSON-RPC transport. It is a credible
richer source when Observatory is already using app-server, but adopting it as
the launch/runtime transport would be a broader product change and could
overlap `SessionHost`. Before V1, spike only whether a read-only observer can
obtain reconnectable snapshots and approval/outcome state without taking over
the CLI execution. Do not assume streamed notifications are durable.

The Codex hooks page explicitly warns that `main`-branch schemas may be ahead
of the current release and that transcript format is unstable. The integration
uses the release documentation and never parses transcripts.

## Delivery plan

### Implemented first pass

The first implementation covers the deterministic Slice 1 path and the safe
acquisition boundary needed to dogfood three providers:

- `AgentHarness.observationSource` is available for the built-in Claude Code,
  Codex and Pi harnesses;
- each source reads a configured, bounded JSONL journal of already normalised
  records and otherwise reports `not-configured`;
- the kernel validates, deduplicates, correlates and stores current claims,
  transitions, source health and cursors in the operational SQLite cache;
- attention, catch-up and inspector projections fuse an immutable evidence
  snapshot without issuing Universe commands; and
- one catch-up acknowledgement checkpoints accepted semantic changes and
  observed evidence independently.

The kernel boundary rejects unbounded identities, diagnostics, cursors and
non-namespaced extensions. Projection fusion applies the shorter of provider
and kernel freshness, preserves conflicting host/provider claims, uses the
canonical attention ordering and recomputes nested Goal/System counts from the
fused Agent views. Removing a source marks its saved evidence unavailable.
Repeated activity transitions are coalesced in catch-up.

The journal is the retained integration boundary. Provider-specific hook
adapters translate raw Claude Code, Codex and Pi event names into one private
lifecycle vocabulary; the journal owns schema decoding, exact harness and
continuity-scope validation, monotonic sequencing, bounded retention,
ownership-safe locking and atomic compaction. The explicit operator-run
installer composes with existing provider settings and publishes
content-addressed bundles; it never replaces unrelated hooks, packages or
extensions. Missed-event repair beyond retained current state remains future
work.

An `AO_PLUGIN_CONFIG` entry for the built-in harness package replaces its
unconfigured default activation, so `claudeObservationOutbox` and
`codexObservationOutbox` can be supplied without creating a duplicate plugin.
`bun run web:mock` loads a mock harness package through the same registry and
source contract; it does not seed the observation store directly.

### Slice 0 — contract and provider spikes

- Add synthetic V1 types, bounds and a shared source contract suite.
- Verify exact installed Claude and Codex versions and document supported event
  matrices.
- Spike Claude hook setup/status-line coexistence and Codex hook failure/status
  mapping; separately assess app-server reconnect snapshots without changing
  launch ownership.
- Decide freshness defaults and operational retention from mock supervision.

Gate: two synthetic sources express identical normalised claims with no
provider brand switch in coordinator, persistence or projections.

### Slice 1 — deterministic kernel path

- Add a kernel-owned operational observation repository to the clean-break
  SQLite schema for envelopes, latest claims, source health and cursors.
- Add the Effectful composition-root coordinator and immutable evidence
  snapshot.
- Add attention, catch-up, inspector and verification projections against a
  deterministic mock source and clock.
- Dogfood supported and unsupported states with `bun run web:mock`; cover source
  loss with deterministic coordinator tests.

Gate: synthetic observations enrich every target projection without changing
an Agent/Goal record or the `System -> Goal -> Agent` topology.

### Slice 2 — Claude Code reference source (implemented locally)

- Add an explicit reviewed local reporter and bounded authenticated sink.
- Translate only the verified event matrix; add status-line context pressure
  only if the Slice 0 coexistence spike succeeds.
- Add restart, duplicate, late-event, missed-start and hook-disabled smokes.

Gate: a real Claude session opens a permission signal, reports response stop
and recovers after Observatory restart with no transcript or raw payload stored.

### Slice 3 — Codex reference source (implemented locally)

- Implement the same contract from supported Codex hooks.
- Leave unsupported failure/context claims explicit.
- Use app-server only where the selected Codex runtime already provides the
  transport and the spike proves snapshot/reconnect behavior without moving
  PTY ownership.

Gate: adding Codex changes only its harness package, configuration and fixtures;
core vocabulary, storage, attention and renderer code require no provider edit.

Pi reuses the same outbox and vocabulary through its extension lifecycle. It
also supplies a provider-owned session catalogue and exact start/resume plans
through the existing harness seam; no Pi brand enters the coordinator,
persistence or projections.

### Slice 4 — measured additions

Consider normalised usage, remote reporter transport or an optional live stream
only after real workflows show the need and both reference sources prove the
semantics. Transcript ingestion and provider-native controls each require a new
explicit product decision.

## Persistence and retention

The experimental database has no compatibility migrations. Observation/source
records are part of the current clean-break schema and remain separate from
accepted Agents and Goals, alongside the existing provider-conversation cache
pattern. The logical records are:

- source registration/health and declared capabilities;
- latest observation claim keyed by source, scoped conversation and id;
- bounded semantic transitions required for catch-up; and
- per-source cursor and last complete snapshot metadata.

Native references remain in sensitive server-side storage. Current claims are
bounded per source, catch-up transitions are deleted after acknowledgement and
the unacknowledged tail has a hard cap. Projection freshness hides expired
non-open claims; complete snapshots remove claims no longer reported. Retention
never mutates accepted state. A semantic database reset may remove this cache
and rediscover it.

## Verification plan

- Shared source contracts: capabilities, complete/partial snapshots, bounds,
  unsupported kinds, redaction and typed failures.
- Reconciliation tests: duplicate, revised, out-of-order and late observations;
  cursor replay; request open/resolve; partial omission; complete-snapshot
  repair; clock skew; source restart, disable, removal and stale recovery.
- Fusion tests: live host + stopped turn, absent host + tool activity, provider
  complete + failing checks and unknown provider + fresh workspace evidence.
- Projection tests: deterministic attention ordering, catch-up coalescing,
  inspector provenance and four-column verification separation.
- Security tests: oversized/deep payload rejection, namespace validation,
  replay authentication and sentinel prompts, credentials, commands, errors
  and transcript paths absent from storage/log/browser snapshots.
- Sanitised Claude and Codex fixtures pass the same source contract. Core tests
  pass with neither provider installed.
- Opt-in live smokes exercise provider versions and hook trust; they never read
  transcripts. `bun run web:mock` is the deterministic browser dogfood path.

Release acceptance requires:

1. Claude and Codex both work through `AgentHarness.observationSource` without
   provider checks outside their packages.
2. Disabling or losing either source visibly degrades enrichment while launch,
   resume, terminal, Agent and Goal state remain valid.
3. Provider-reported completion never changes accepted completion and never
   substitutes for diff/check evidence.
4. No forbidden content appears in fixtures, persistence, diagnostics, API or
   browser projections.
5. Snapshot repair and stale behavior pass deterministic restart/loss tests.
6. Effect is confined to plugin/coordinator/storage I/O; attention, catch-up,
   verification, projection and spatial calculations are pure.

## Roadmap decision

Move the metadata-only observation path from **Later** to **Next**. It directly
unblocks the already-prioritised rich attention and coherent completion review
workflows, and Claude plus Codex now provide enough documented evidence to test
the generic contract. Ship synthetic projection behavior before live hooks and
require the second provider proof before calling the seam complete.

This does not move transcript ingestion, provider-native controls, generic
usage analytics, remote service operation or a new host forward.

## Rejected alternatives

- **Hooks own Agent state.** Lossy delivery would make provider support define
  semantic correctness and degrade non-hook providers dishonestly.
- **Add `ClaudeEvent | CodexEvent` to core.** Provider releases would force
  kernel and renderer changes and prevent a contributor proving the contract.
- **Add a provider facts service beside `AgentHarness`.** It duplicates plugin
  lifecycle, identity scope and provider ownership with a pass-through seam.
- **Use `SessionHost` for provider events.** A PTY host does not own provider
  turn semantics, and provider observations may exist with no execution.
- **Persist arbitrary provider JSON.** It defeats data minimisation, stability,
  bounds and deterministic cross-provider behavior.
- **Build a universal event bus.** V1 needs one pullable capability feeding one
  coordinator, not arbitrary publishers and subscribers.
- **Read transcripts to recover missed events.** Transcript formats are
  unstable and contain exactly the content excluded from this slice.
- **Treat stopped response as completion.** A stopped turn, independently
  observed checks and human-accepted completion are different facts.
- **Require identical provider fidelity.** Explicit unsupported and stale
  states are more honest than inferred parity.
- **Adopt Codex app-server as the host.** Structured events do not justify
  replacing the existing `SessionHost`/PTY boundary in this feature.

## Open implementation decisions

1. Can Claude context pressure coexist with an existing user status line, or
   should the first Claude source report compaction only?
2. Which safe, documented Codex field distinguishes a failed turn or non-zero
   tool result without parsing output in the minimum supported release?
3. Can Codex app-server provide a bounded reconnect snapshot to an observer
   without Observatory becoming its launching client?
4. What measured freshness and retention defaults produce useful attention
   without repeatedly surfacing stale open requests?

These spikes affect fidelity, not the authority model or core contract.
