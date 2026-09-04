# Structured conversation interaction

Status: proposed feasibility study; not committed to the product roadmap

Updated: 2026-09-04

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Agent harness plugins](agent-harness-plugins.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)
- [Browser terminal interaction](../design/terminal-interaction.md)

## Decision to investigate

Investigate an optional structured conversation surface for supported agent
harnesses. Do not begin with a universal chat implementation.

The product question is whether an operator can understand and resolve an
Agent's current turn without reconstructing it in a terminal. The proposed
surface complements rather than replaces the host-owned terminal:

```text
Atlas / Needs you / Catch up
              |
              v
    selected Agent workspace
      +--> Conversation: understand and respond
      +--> Review: inspect evidence and accept outcomes
      +--> Terminal: full-fidelity intervention and recovery
```

This is a substantial product and architecture change. It introduces sensitive
conversation content, bidirectional provider control, streamed protocol state,
request freshness and reconnect semantics. It must pass the feasibility gate in
this document before its interface or UI is treated as committed.

## Product boundary

Observatory remains a semantic control plane, not a model provider or general
agent runtime. Structured interaction is valuable only when it shortens a
supervisory decision discovered elsewhere in Observatory.

The intended promise is:

> Understand the current exchange and make ordinary supervisory decisions
> without opening the terminal.

It is not:

> Reproduce every feature of Claude Code, Codex, Pi or another native client.

The terminal remains required for unsupported providers, provider-specific
features, raw shell work, recovery and interactions that cannot be represented
honestly through the structured capability.

## Target workflows

### Resolve a Needs-you request

1. Select a permission, question or plan-review decision in Needs you.
2. Open the exact Agent conversation at the unresolved request.
3. Read enough preceding context to understand the request.
4. Submit one allowed response against the exact fresh request identifier.
5. See acknowledgement or failure without losing Atlas position.

### Review a returned result

1. Open a provider-reported review candidate.
2. Read the latest bounded assistant response.
3. Compare it with diff, checks, pull-request and integration evidence.
4. Ask a follow-up, request a revision or open the terminal.
5. Accept Agent or Goal completion only through the existing human command.

### Continue a dormant conversation

1. Open the known conversation history.
2. See that no execution is currently proved live.
3. Explicitly resume the exact conversation.
4. Wait for continuity and structured-control proof.
5. Submit a prompt only after the same conversation is confirmed.

Sending a message must never silently start, resume or select a conversation.

## Proposed experience

The current terminal destination becomes an Agent workspace that preserves the
Atlas camera and renderer-local selection:

```text
+------------------------------------------------------------------+
| Goal / Agent                 Working - Claude - context elevated  |
+-----------------------------------------+------------------------+
| Conversation                            | Evidence               |
|                                         |                        |
| You                                     | 6 files changed        |
| Fix the failing refresh flow.           | 2 checks passing       |
|                                         | PR not opened          |
| Agent                                   |                        |
| I found the stale token path...         | [Open review]          |
|                                         | [Open terminal]        |
| > Read 8 files                          |                        |
| > Modified auth/session.ts              |                        |
|                                         |                        |
| + Permission required ----------------+ |                        |
| | Run the integration tests?          | |                        |
| | [Allow once] [Reject]               | |                        |
| +-------------------------------------+ |                        |
+-----------------------------------------+------------------------+
| Ask a follow-up...                              [Stop] [Send]     |
+------------------------------------------------------------------+
```

Primary tabs are:

- **Conversation** — bounded structured history, current activity and controls;
- **Review** — working-tree, checks, code-host and acceptance evidence; and
- **Terminal** — the existing host-owned terminal plus linked terminal tabs.

A Needs-you jump scrolls to the matching unresolved request. Conversation
selection does not move accepted Goal positions or mutate semantic state.

## Initial interaction vocabulary

The renderer receives a small provider-neutral vocabulary rather than raw
provider payloads.

### Conversation items

- human message;
- assistant Markdown message;
- coarse activity summary;
- human-input request;
- bounded provider notice or failure.

Assistant streaming is represented as revisions to one stable item, not a new
item per token. Activity is collapsed by default and uses the existing safe tool
categories: read, write, execute, search, network, delegate and other.

### Controls

- submit one text prompt;
- interrupt one exact active turn;
- respond to one exact open permission, question or plan-approval request; and
- explicitly resume a dormant exact conversation before control is enabled.

Every mutation has an idempotency identifier and receives an explicit accepted,
rejected or unknown result. Browser optimism must not turn a timed-out command
into an apparently accepted prompt or approval.

### Deliberate first-slice exclusions

- attachments, images and arbitrary files;
- arbitrary tool inputs, outputs and shell commands;
- provider reasoning or hidden chain-of-thought;
- model, mode and reasoning-effort changes;
- slash commands and prompt-template emulation;
- conversation fork, edit and rewind;
- transcript search or cross-Agent content indexing;
- provider-native subagent graphs;
- usage and cost normalisation; and
- automatic semantic commands derived from message content.

## Capability and degradation rules

Structured interaction is progressive enhancement on an accepted Agent.

| Evidence and capability                                      | Behaviour                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Structured history and control are fresh                     | Show conversation and enable declared controls                  |
| History is available but control is unsupported              | Show read-only conversation and direct response to the terminal |
| Prompt submission is supported but request response is not   | Enable composer; route approvals and questions to the terminal  |
| Harness has no structured capability                         | Explain the limitation and open the terminal                    |
| Exact conversation is dormant and resumable                  | Show available history; require explicit resume before sending  |
| Runtime or structured connection is unknown                  | Preserve readable evidence where valid; disable control         |
| Two executions claim the same conversation                   | Disable implicit selection and all structured mutations         |
| A request is stale, withdrawn or already resolved            | Show its state; reject a response until fresh proof exists      |
| Structured transport fails while the terminal remains usable | Degrade the Conversation tab without changing Agent lifecycle   |

Missing history must be labelled unavailable or partial. It must never be
presented as an authoritative beginning of the conversation.

## Provider feasibility constraint

A structured conversation cannot be reconstructed safely from an interactive
terminal. Observatory must not parse ANSI screens, scrape unstable transcript
files or inject terminal keystrokes while presenting them as structured
commands.

A production harness therefore needs one of two provider-supported modes.

### Attached structured mode

The provider permits a client to attach to an existing exact conversation and
obtain a bounded history snapshot, ordered live events, stable request
identifiers and command acknowledgement. The feasibility study must prove
whether structured and native terminal clients may coexist and which one owns
control.

### Managed structured mode

The harness uses a documented app-server, JSON-RPC, SDK or JSON process mode.
`SessionHost` still owns process placement and terminal capabilities;
`AgentHarness` owns provider protocol semantics. The design must not add
provider commands to `SessionHost` or let a plugin spawn an untracked process.

Managed structured mode may mean there is no provider TUI for that execution.
In that case **Open terminal** opens a companion shell or an explicit provider
handoff, not a fabricated terminal view of the conversation. The UI must state
that distinction.

If neither mode can prove exact identity, replay, request freshness and command
acknowledgement, that harness remains terminal-only.

## Proposed module interface

Structured interaction deepens the existing `AgentHarness` capability. It does
not create a provider pass-through module beside the harness and does not enter
Universe, persistence, attention or spatial interfaces.

```ts
interface AgentHarness {
  // Existing lifecycle and observation members.
  readonly conversationController?: AgentConversationControllerV1;
}

interface AgentConversationControllerV1 {
  readonly schemaVersion: 1;
  describe(): AgentConversationCapability;
  open(
    request: OpenAgentConversationRequest,
  ): Effect<AgentConversationConnection, AgentConversationError>;
}
```

`open` targets one exact opaque provider conversation:

```ts
interface OpenAgentConversationRequest {
  readonly nativeConversationRef: OpaqueNativeConversationRef;
  readonly providerInstanceId: string;
  readonly afterCursor?: string;
  readonly historyLimit: number;
}

interface AgentConversationConnection {
  readonly snapshot: AgentConversationSnapshot;
  readonly events: Stream<AgentConversationEvent, AgentConversationError>;
  send(
    command: AgentConversationCommand,
  ): Effect<AgentConversationCommandResult, AgentConversationError>;
  close(): Effect<void, never>;
}
```

The command union is deliberately narrow:

```ts
type AgentConversationCommand =
  | {
      readonly kind: "submit-prompt";
      readonly commandId: string;
      readonly text: string;
    }
  | {
      readonly kind: "respond-to-request";
      readonly commandId: string;
      readonly requestId: string;
      readonly response: AgentRequestResponse;
    }
  | {
      readonly kind: "interrupt";
      readonly commandId: string;
      readonly turnId: string;
    };
```

The connection interface is provisional. The feasibility study must first show
that two provider adapters can satisfy its identity, replay and control
semantics without provider switches in the coordinator or renderer. One
adapter proves an implementation; two prove the seam.

## Normalised content

A snapshot and live events use stable item and revision identifiers:

```ts
type AgentConversationItem =
  | AgentUserMessage
  | AgentAssistantMessage
  | AgentActivityItem
  | AgentHumanRequest
  | AgentProviderNotice;

interface AgentAssistantMessage {
  readonly kind: "assistant-message";
  readonly itemId: string;
  readonly revision: number;
  readonly turnId?: string;
  readonly createdAt: number;
  readonly state: "streaming" | "complete" | "interrupted";
  readonly blocks: readonly AgentConversationBlock[];
}

type AgentConversationBlock =
  | { readonly kind: "markdown"; readonly text: string }
  | {
      readonly kind: "activity-summary";
      readonly category: AgentToolCategory;
      readonly state: "running" | "succeeded" | "failed";
      readonly label?: string;
    };
```

An actionable request includes only provider-declared response shapes:

```ts
interface AgentHumanRequest {
  readonly kind: "human-request";
  readonly itemId: string;
  readonly requestId: string;
  readonly requestKind: "permission" | "question" | "plan-approval";
  readonly prompt: string;
  readonly responses: readonly AgentRequestOption[];
  readonly state: "open" | "resolved" | "withdrawn" | "stale";
}
```

The kernel defines bounds for item count, text size, block count, option count
and event rate. An adapter translates and discards unsupported provider fields
before they cross the plugin interface.

## Authority and state

Conversation content is operational provider data, not accepted Observatory
state.

- It cannot create or admit an Agent.
- It cannot establish conversation identity or execution presence.
- It cannot complete, assign, prioritise or archive an Agent or Goal.
- A provider-reported answer cannot fill repository, check or code-host evidence.
- Existing metadata-only observations continue to drive global Needs-you and
  Catch-up projections.
- A control command targets only an exact fresh provider conversation and, when
  applicable, an exact request or turn.

The composition root resolves the browser's accepted `AgentId` to its sensitive
conversation reference server-side. Native references do not enter browser
projections.

## Process and control ownership

A provider may forbid simultaneous structured and TUI controllers. Every
adapter must declare and enforce one control model:

- `concurrent`: structured and terminal clients can safely coexist;
- `handoff`: only one controller is active and switching is explicit; or
- `structured-only`: the execution has no native conversation TUI.

The first implementation permits at most one structured controlling connection
per conversation. Additional browser views are read-only unless the adapter
proves safe multi-controller semantics. Closing a browser connection does not
terminate the Agent.

Switching control must fail closed if continuity changed, another execution now
owns the conversation, or the provider cannot confirm release. Observatory
must never send the same prompt through both terminal and structured channels.

## Browser gateway

The browser uses a capability exchange similar to terminal access:

1. Request structured access for an accepted `AgentId`.
2. Resolve exact conversation identity and the owning harness server-side.
3. Revalidate current continuity, execution conflict and declared capability.
4. Open the harness controller and retain a random process-local session handle.
5. Upgrade that handle to an origin-checked WebSocket.
6. Deliver a bounded snapshot and delivery-numbered live events.
7. Accept only schema-validated commands over the same ordered connection.
8. Acknowledge each `commandId` exactly once or return an explicit uncertain
   outcome when the provider cannot prove the result.
9. Release the controller on explicit close or bounded disconnect expiry.

Reconnect requests events after the last delivery identifier. If bounded replay
cannot fill the gap, the gateway obtains a new authoritative provider snapshot
or fails closed. It does not splice an incomplete stream into apparently
continuous history.

The gateway observes backpressure, limits sessions per Agent and globally, and
never places prompt or response text in URLs, diagnostics or access logs.

## Persistence, privacy and security

The first slice does not persist conversation content in Universe SQLite.

- The provider remains the source of record for history.
- Opening a Conversation tab obtains a bounded snapshot on demand.
- The server retains only a bounded process-local replay buffer for active
  browser connections.
- Content is excluded from Atlas, Ledger, search, Catch up and normal SSE
  projections.
- Prompt, response, question, plan and tool text is excluded from logs,
  diagnostics, crash reports and fixtures.
- Markdown, links, filenames and labels are untrusted and rendered without raw
  HTML or executable URLs.
- Browser copy, selection and local cache are presentation concerns and must not
  silently create durable transcript storage.

This changes the current privacy boundary even without persistence: sensitive
conversation content passes through the Observatory process and browser. The
implementation therefore requires an explicit security review, bounded
redacted fixtures and tests with sentinel credentials and instructions.

A future searchable or durable transcript store is a separate product decision.

## Failure semantics

- A dropped structured stream does not prove the turn stopped or the Agent died.
- A provider command timeout is `unknown` unless a fresh snapshot proves whether
  it applied; the gateway does not automatically retry a non-idempotent command.
- A stale request response is rejected rather than redirected to the current
  request.
- Provider history truncation is visible and never filled from terminal output.
- Losing the controller degrades only structured interaction; accepted semantic
  state and terminal access remain valid independently.
- Plugin disable, crash or upgrade closes its structured sessions and reports
  the capability unavailable.
- Unsupported content becomes a bounded provider notice or an explicit route to
  the terminal, never an invented common representation.

## Feasibility study

Before UI implementation, build disposable provider spikes for Pi, Codex and
Claude Code. For each installed supported version, answer:

1. Can a client attach to an existing exact conversation?
2. Can it obtain bounded authoritative history and a replay cursor?
3. Can it reconnect after Observatory or the provider transport restarts?
4. Can a native terminal client and structured client coexist?
5. Does submission return a stable acknowledgement or idempotency key?
6. Do permissions, questions and plans have stable request identifiers and
   declared response options?
7. Can an exact active turn be interrupted safely?
8. Can `SessionHost` place the process without learning provider protocol?
9. Does the provider require Observatory to become the primary process client?
10. What does terminal handoff mean in each mode?
11. Which content crosses process and browser boundaries?
12. Can fixtures and diagnostics prove that content is not retained or logged?

Record unsupported answers explicitly. Do not bridge gaps with terminal parsing
or transcript scraping.

## Delivery slices and stop gates

### Slice 0: provider feasibility only

- Build no maintained UI or plugin interface.
- Exercise exact attach/start, history, live events, request response,
  interruption, disconnect and resume against disposable conversations.
- Produce a capability matrix and sanitised protocol fixtures.

Stop if two providers cannot support a coherent identity and control model, or
if doing so requires Observatory to own an untracked runtime.

### Slice 1: synthetic contract and mock experience

- Define provisional serialisable types and bounds.
- Add a synthetic controller with deterministic replay, stale requests,
  disconnects and command uncertainty.
- Prototype Conversation, Review and Terminal tabs against the mock only.

Stop if ordinary Needs-you and result-review decisions are not materially
clearer or faster than opening the terminal.

### Slice 2: first real read-only adapter

- Implement bounded history and live assistant/activity rendering for the best
  supported provider.
- Keep all controls disabled.
- Verify content isolation, reconnect and terminal coexistence.

Stop if authoritative replay is unavailable or the provider protocol requires
frequent provider-specific renderer exceptions.

### Slice 3: controlled mutations

- Add prompt, exact request response and interrupt one at a time.
- Require command-idempotency, stale-target and ambiguous-outcome tests.
- Add a second provider before stabilising the external interface.

Stop if safe acknowledgement cannot be distinguished from timeout or if the
second provider makes the shared interface as complex as both implementations.

### Slice 4: product integration

- Connect Needs-you jumps, result review and explicit dormant resume.
- Measure terminal opens by reason and whether operators return to Observatory.
- Keep terminal-only harnesses first-class.

Do not add attachments, transcript persistence or richer provider controls as
part of this slice.

## Evidence gate

Proceed beyond the feasibility study only if:

1. at least two providers support an exact, bounded structured conversation
   path without ANSI or transcript parsing;
2. the adapters can satisfy one small interface without provider branches in
   Universe, projection or renderer modules;
3. process placement remains owned by `SessionHost` and provider protocol by
   `AgentHarness`;
4. prompt and request mutations have safe acknowledgement, stale-target and
   reconnect semantics;
5. losing the capability leaves Agent identity, semantic state and terminal
   access intact;
6. sensitive content remains bounded, ephemeral and absent from persistence and
   diagnostics; and
7. mock user testing shows fewer unnecessary terminal opens for supervisory
   decisions.

If these conditions fail, keep the terminal as the interaction surface and use
structured provider integration only for metadata observations.

## Verification expectations

A maintained implementation would require:

- shared controller contract tests for snapshot bounds, revisions, replay,
  control ownership and close;
- adapter tests from sanitised provider fixtures;
- exact identity, replacement and dual-execution conflict tests;
- duplicate command, stale request, timeout and reconnect tests;
- gateway origin, capability-handle, backpressure and resource-limit tests;
- sentinel-content tests across persistence, logs, diagnostics, projections and
  fixtures;
- browser tests for Needs-you jumps, partial history, disabled controls,
  terminal handoff and preserved Atlas position; and
- disposable live smokes for each supported provider and version.

Normal Observatory quality gates remain required after supported code or
documentation changes.

## Rejected shortcuts

- **Parse the terminal into chat messages.** Alternate screens and ANSI output
  are presentation, not an authoritative conversation protocol.
- **Read provider transcript files as the live interface.** Formats are
  unstable, privacy-sensitive and usually cannot acknowledge controls safely.
- **Treat terminal input as prompt submission.** Keystroke delivery does not
  prove provider acceptance and can target the wrong UI state.
- **Put provider protocol on `SessionHost`.** Execution placement does not own
  conversation semantics.
- **Persist transcripts by default.** Structured control does not require a new
  durable content store.
- **Advertise parity across harnesses.** Honest terminal fallback is preferable
  to inferred or unsafe controls.
- **Build the complete chat UI before provider spikes.** The largest risks are
  protocol ownership, replay and acknowledgement rather than rendering.
