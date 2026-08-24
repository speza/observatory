# Contextual linked execution surfaces

Status: accepted and implemented for the native renderer
Date: 2026-08-24
Related: [Agent and linked execution model](agent-execution-model.md),
[Embedded terminal interaction](../design/terminal-interaction.md),
[Observatory technical architecture](../design/technical-architecture.md)

## Summary

Observatory lets a person inspect supporting shells and sibling agents without
leaving the spatial map or returning to Herdr. A selected Agent can expose any
number of host-provided `LinkedExecution` values. These can be used to start a
local application, run tests or watchers, inspect logs, or run the user's
preferred diff/review tool.

Native diff rendering is deliberately deferred. A linked shell is the flexible
surface for `git diff`, `delta`, hunk review, or any other local workflow.

Linked executions are transient renderer capabilities. They are not durable
Universe objects, map nodes, or another level in the `Goal -> Agent` topology.

## Product decision

The spatial map is the discovery and navigation surface. Selecting an Agent
reveals `Open linked terminal` in its inspector/menu and through the keyboard
shortcut. If the host reports multiple available linked executions, Observatory
opens a picker showing each shell or sibling Agent by label.

The renderer deliberately keeps the composition small:

- one primary surface: the map or the selected Agent terminal; and
- one selected linked execution surface beside it.

This allows simultaneous review without pretending to be a general-purpose
multiplexer. The picker supports N linked shells and sibling agents even though
only one is visible as the secondary surface at a time.

```text
map + selected linked shell
        or
Agent terminal + selected linked shell/agent
```

Only the focused surface receives ordinary keyboard input. All visible
surfaces continue to receive output updates.

## Host contract

`SessionHost` is the only host seam. The generic capability is:

```text
access({ hostKind, nativeId }) -> AgentAccess

AgentAccess.linkedExecutions: readonly LinkedExecution[]

openLinkedExecutionTerminal(
  LinkedExecution,
  TerminalDimensions,
) -> Effect<HostTerminalOpenResult, HostError>
```

`LinkedExecution` contains:

```text
kind: shell | agent
label: string
owner: opaque host target
workingDirectory?: string
target?: opaque host target with an adapter-owned identity binding
available: boolean
source: observed | prepared
explanation: string
```

The renderer never interprets Herdr workspace, tab or pane identifiers. The
adapter resolves the opaque target and owns process, PTY, resize and release
lifecycle. Before attach or takeover, the adapter revalidates the target against
a fresh host snapshot and rejects a missing, changed or reused terminal identity.

Herdr reports sibling panes in the same host context and working directory.
Recognised sibling agents are returned with `kind: agent`; shell-only panes are
returned with `kind: shell`. If no matching shell is observed but a trustworthy
working directory exists, Herdr may return one `prepared` shell capability.

The mock host reports multiple deterministic shells and a sibling-agent link so
the picker and both linked-execution kinds are testable without Herdr.

## Shell-to-agent promotion

Observatory does not promote a shell based on its label, worktree or terminal
contents. If the person starts Claude, Codex, Pi or another supported agent in
the linked shell, the host's next authoritative snapshot may include that
execution in `HostSnapshot.agents`.

The same host/native identity is then reconciled as a normal durable Agent. It
appears as its own selectable map node and may have its own linked executions.
There is no duplicate durable shell object and no automatic Goal assignment.

## Interaction flow

### Open from the map

1. Select an Agent.
2. Choose `Open linked terminal` or press the linked-terminal shortcut.
3. If one execution is available, open it directly.
4. If several are available, choose one in the linked-execution picker.
5. Observatory shows the chosen surface beside the map and keeps the Agent
   selection and spatial context.

### Open beside the Agent terminal

1. Select an Agent and open its primary terminal.
2. Invoke the linked-terminal action from the review context.
3. Choose a shell or sibling Agent when the picker appears.
4. Use the explicit focus-cycle action or click a surface to switch input.

The linked picker is a modal root surface above terminal panels, so its frame
and rows remain visible and clickable when opened from review mode. While any
modal or picker is open, keyboard and paste input belongs to that modal rather
than to the focused terminal. A host refresh revalidates the owner and replaces
the picker rows from the latest access capability; it closes only when no valid
owner or linked execution remains.

Changing the selected Agent releases both terminal surfaces belonging to the
previous Agent. This prevents stale contextual terminals from receiving input
and keeps the map selection authoritative.

## Lifecycle and failure behaviour

- No selected Agent: do not offer the action.
- No available link: show the host explanation and keep the map usable.
- Missing working directory: do not guess a location or silently run elsewhere.
- Stale opaque target: report that the selected execution is no longer
  available; do not reinterpret it as a different pane.
- Stream closes: retain the parent selection and show the close reason until the
  user closes the surface or reopens a current link.
- Release/detach: release Observatory's host controller according to the host
  contract; do not claim that a user-owned long-running process stopped.
- Renderer resize: resize both open host terminals and preserve focus where
  possible.
- Host disconnect: preserve the accepted Agent and mark the linked capability
  unavailable or uncertain; never convert absence into completion.

The first version does not persist linked-execution surfaces across an
Observatory restart. Durable Agent identity and human assignment do persist.

## Non-goals

- A durable linked-execution table or map node.
- An arbitrary nested split tree or user-authored pane layout.
- A daemon, AO-owned multiplexer, or AO-owned process lifecycle.
- Transcript ingestion or provider-specific conversation rendering.
- Native diff/review UI.
- Automatic command execution from a map action.
- Automatic Goal assignment from a shared worktree or host context.

## Acceptance criteria

The implementation is acceptable when:

1. The normal map contains only durable Goals and Agents.
2. A selected Agent exposes the linked-terminal action without requiring Herdr.
3. N available host links are visible in a picker with shell/agent kind labels.
4. A chosen link opens entirely inside Observatory.
5. The primary map or Agent terminal remains visible beside it.
6. Focus ownership is explicit and ordinary input cannot reach the wrong
   surface.
7. The selected shell starts in the host-provided trustworthy worktree.
8. A user can run a preferred diff/review tool in the shell.
9. Shell-only panes are never reconciled as durable Agents.
10. A later host snapshot can recognise a promoted shell as a normal Agent using
    its existing native identity.
11. Mock and sanitised Herdr fixtures prove N links, shell links, sibling-agent
    links, prepared links, open/resize/input/release, fresh target identity
    validation, and stale-target errors.
