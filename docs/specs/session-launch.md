# Agent launch and workspace preparation

Status: implemented web start and exact-resume flow
Updated: 2026-09-02

Depends on:

- [Technical architecture](../design/technical-architecture.md)
- [Plugin architecture](../design/plugin-architecture.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Agent harness plugins](agent-harness-plugins.md)

## Decision

Observatory accepts one structured start or exact-resume intent and owns the
coordination across workspace preparation, provider planning, host placement,
identity reconciliation and Goal assignment.

```text
Browser launch intent
       │
       ▼
StartAgentCoordinator
  ├── WorkspaceProvider
  ├── AgentHarnessRegistry
  ├── SessionHost
  ├── canonical observation path
  └── Universe commands
```

The browser does not call Git, provider CLIs or Herdr directly. The coordinator
is the deep module that hides their ordering and partial-failure behaviour.

## Interface

A start intent contains:

- an idempotency request ID;
- selected harness;
- existing checkout or requested worktree;
- optional display name;
- target existing Goal, new Goal or Inbox; and
- the explicit prompt supplied for a new conversation.

An exact-resume intent contains the request ID, Agent identity and selected
eligible workspace. The coordinator resolves the opaque provider conversation
reference from trusted server-side state; the browser never supplies provider
session locators.

Results are typed as started, pending, unavailable, rejected or already
completed. A durable launch receipt records enough structured evidence to
recover an accepted host launch without launching it again.

## Invariants

1. A pending launch is visible but is not a durable Agent.
2. An Agent is created or resolved only after exact provider conversation
   identity is observed.
3. Assignment happens only after the exact Agent exists.
4. Retrying the same request ID does not ordinarily launch another process.
5. A setup failure is durably distinguished from post-launch uncertainty; a
   receipt without a proven host outcome is never described as completed.
6. Reusing a request ID for different intent is rejected.
7. Provider command syntax belongs to AgentHarness plugins.
8. Process and terminal placement belongs to SessionHost.
9. Git and worktree mechanics belong to WorkspaceProvider.
10. No launch step writes Universe state around its commands.
11. Weak cwd, title, repository or recency matches never complete launch
    identity.

## Start flow

1. Validate the request ID and atomically reserve its launch receipt.
2. Validate harness availability and the Goal intent without creating a Goal.
3. Validate or prepare the workspace.
4. Ask the selected harness for a structured new-conversation process plan.
5. Observe host availability and only then materialise a requested new Goal.
6. Ask SessionHost to execute the plan.
7. Persist the execution reference immediately when the host accepts placement.
8. Poll canonical host/provider observations for exact conversation identity.
9. Create or resolve the Agent through Universe observation.
10. Assign it to the requested Goal, or retain it in Inbox.
11. Mark the receipt complete and return the refreshed projection.

A failure before process placement is saved as a failed receipt and returned as
the original typed error. Repeating that request ID reports the durable failure
rather than claiming that a launch was observed. Once process placement has
been attempted, an unknown outcome remains pending and is never retried
automatically without host evidence.

A blank-prompt launch may open an immediate temporary host terminal while the
provider creates its durable conversation. The UI labels that surface as
starting work; it must not render a phantom Agent card.

## Exact-resume flow

Resume is available only when provider evidence proves one dormant conversation
and the harness supports exact resume in the current continuity scope.

1. Revalidate provider continuity and resume eligibility.
2. Block ordinary resume if a plausible unidentified live execution may already
   own the conversation.
3. Ask the harness for a structured exact-resume plan.
4. Launch one new host execution.
5. Reconcile the exact conversation back into the existing Agent.
6. Preserve Goal, human metadata and Agent ID while replacing execution binding.

Unknown, conflicting, unsupported or remotely non-portable continuity never
becomes an optimistic resume button.

## Workspace behaviour

`WorkspaceProvider` supports:

- a bounded list of recent choices;
- an existing checkout;
- a new Git worktree and branch;
- validated browsing under configured local roots; and
- an explicit path-entry escape hatch.

Workspace preparation reports dirty checkout, branch collision and filesystem
errors before host launch. A worktree created before a later host failure is
reported for explicit cleanup; Observatory does not delete it automatically. A
new Goal is materialised only after setup and host observation succeed. If the
subsequent placement attempt fails or has an unknown outcome, that human intent
is retained rather than automatically deleting or archiving the Goal.

Repositories and worktrees remain Agent metadata and launch context. They do
not become Systems or Goals.

## Partial failure and recovery

- Invalid or inaccessible path: store a pre-launch failure and reject before
  provider or host placement.
- Harness unavailable: preserve semantic state, store the setup failure and
  return a bounded explanation.
- Host unavailable before placement: preserve the failed receipt and do not
  claim process creation.
- Host accepts launch but identity is delayed: return pending and continue
  reconciliation without relaunching.
- Host execution appears without exact provider identity: retain diagnostic
  evidence only.
- Exact Agent appears but assignment fails: keep it in Inbox and report the
  partial result.
- Observatory restarts after host acceptance: recover from the receipt and
  observations rather than repeating process creation.
- Provider or host identity conflict: stop and require inspection.

Exactly-once process creation across an abrupt external host failure cannot be
proved universally. The coordinator promises durable idempotency where its
receipt and host evidence are sufficient and preserves uncertainty otherwise.

## Provider-specific interaction

The embedded browser terminal guarantees normal text terminal interaction. It
does not claim every provider-native attachment, clipboard or graphical
feature.

Unsupported provider-specific operations remain explicit. SessionHost exposes
only proven generic capabilities, including a capability-gated native handoff.
A future provider plugin may add a narrow file or image capability, but the
Universe and generic terminal interface must not speculate one into existence.

## Security and privacy

- Launch plans are structured argument vectors, not shell strings.
- Browser requests do not contain host-native pane, tab or workspace IDs.
- Provider conversation references remain opaque and server-side.
- Diagnostics are bounded and exclude prompts, terminal output and transcript
  paths.
- Workspace browsing and diff review are rooted and bounded.
- Cleanup, completion and archive remain explicit human actions.

## Verification

The implemented contract is covered by:

- coordinator tests for new launch, delayed identity, duplicate requests,
  restart recovery, exact resume and possible-running protection;
- WorkspaceProvider tests over disposable Git repositories;
- shared SessionHost launch contract tests for mock and Herdr adapters;
- browser gateway tests for options, start, resume and pending terminals; and
- live smoke paths using disposable Agents only.
