# Observatory agent launch and workspace preparation

Status: TUI and local web launch slices implemented; CLI work remains
Date: 2026-08-23
Depends on: [Observatory technical architecture](../design/technical-architecture.md), [plugin architecture](../design/plugin-architecture.md)

## Why this exists

Observatory currently discovers agents that already exist. That is enough to
organise work, but it leaves the most common transition outside the product:

```text
I have a piece of work
  -> choose the project or directory
  -> decide whether to reuse the checkout or make a worktree
  -> choose Claude Code, Codex or Pi
  -> start the agent
  -> put it in the right goal
```

Today this is a chain of manual shell, Herdr and Observatory actions. It is
slow for a human and gives an orchestrator a bad contract: it must create a
host agent, discover its opaque identity, then make a second call to attach
that agent to Observatory. The product should accept one launch intent and
own the coordination.

The purpose of this slice is not to make Observatory a general process runner.
It is to make starting a hosted agent a first-class control-plane
workflow while keeping project, Git and Herdr mechanics behind adapters.

## Design decision

The canonical operation is a single `StartAgent` intent:

```text
TUI / local CLI / agent skill
          |
          v
StartAgentCoordinator
   |              |                 |
   v              v                 v
Workspace     Universe          SessionHost
provider      commands          (Herdr first)
   |                                |
   +-- recent projects / Git         +-- workspace / pane / agent launch
                                   +-- host snapshot and reconciliation
```

The caller supplies one request. Observatory resolves or prepares the
workspace, asks the selected `SessionHost` to launch the agent, reconciles the
resulting host observation, and assigns the agent to the requested goal.

The caller does not call Herdr directly in the normal path. Herdr remains the
V0/V1 implementation behind `SessionHost`. An agent started directly through
vanilla Herdr is still discovered and remains usable, but it appears unassigned
until a human or an explicit link operation assigns it.

## User experience

### Quick start

`New agent` opens a short wizard with safe, recent defaults:

1. **Goal** — current goal, another existing goal, new goal, or inbox.
2. **Location** — recent projects/directories first; browse configured roots
   and choose a directory. The local web client also provides an explicit,
   validated path-entry escape hatch, but it is not the default interaction.
3. **Workspace** — existing checkout or new worktree.
4. **Agent** — one of the initial launch options: Claude Code, Codex or Pi;
   the host supplies the selectable options and user-facing labels so users do
   not need to remember provider command names. Other discovered providers may
   remain observable, but are not launch choices in this first slice.
5. **Prompt** — optional initial instruction and optional agent name.

The wizard should make the common path one or two selections rather than
forcing a full configuration form. The first TUI and local web slices are intentionally
smaller: open `New agent` (or press `N`), keep the current directory or browse another directory,
choose an existing checkout or a new worktree, then select the host-supported
agent, optional name and prompt. The initial location choices come from the current
directory, known agent worktrees and the optional `AO_WORKSPACE_LOCATIONS`
path-list environment variable. Recency ranking, branch/base/path controls and
provider argument editing remain follow-up work on the same coordinator
contract.

The selected project is a location, not a new Observatory topology node. The
resulting agent carries repository, branch and worktree metadata; the map
remains `Goal -> Agent`.

### Location picker

The location picker is deliberately practical rather than a full IDE file
browser:

- recent locations, sorted by use and searchable by name/path;
- explicitly added directories, remembered locally;
- Git root and current branch when the path is a checkout;
- an optional advanced path-entry mode with validation and clear errors; and
- no recursive scan of the user's home directory by default.

The picker can later grow configured roots and favourites without changing the
launch contract. A path is never accepted merely because it exists: the
workspace provider reports whether it is a Git checkout, a plain directory,
dirty, already used by another agent, or unavailable.

### Worktree choice

The first version supports two explicit modes:

- **Existing checkout:** launch in the selected directory. Warn when the
  checkout is dirty or already has active agents; do not silently create a
  competing process in it.
- **New worktree:** create a linked worktree from the selected repository,
  choose a branch/base/path, then launch in the new checkout.

Defaults should be configurable. A code-writing agent should not silently
mutate a shared checkout merely because it was the last location used.

Worktree creation is non-destructive by default:

- reject branch and path collisions before launching;
- never overwrite an existing checkout;
- do not delete a newly created worktree automatically after a later launch
  failure; show an explicit cleanup action instead; and
- preserve the worktree as useful user state even when the agent exits.

## Launch intent

The public command shape is intentionally small and serializable:

```text
StartAgentIntent {
  requestId: string                 // caller-provided idempotency key
  goal: ExistingGoal | NewGoal | Inbox
  workspace: ExistingLocation | NewWorktree
  agent: { kind: string, name?: string, args?: string[] }
  prompt?: string
  agentName?: string
  mode?: "manual" | "auto" | "hybrid"
}
```

The exact transport is deliberately separate from this interface. The first
consumer can be a local JSON CLI (`observatory agent start --json`) and the
TUI can call the same coordinator directly. A Unix-socket control transport is
only justified once a second live client or concurrent agent process needs
subscriptions; it must not become a second domain interface.

`requestId` is required for agent callers. V1 promises retry detection within
Observatory, not exactly-once process creation across a host crash. The result
must say whether the request was started, already observed, pending host
reconciliation, or failed.

## Module and seam design

### `StartAgentCoordinator`

This is the deep module exposed to the TUI, CLI and agent skill. Its interface
owns ordering, failure handling, reconciliation and goal assignment so callers
do not repeat those steps.

```text
start(intent) -> Effect<StartAgentResult, LaunchError>
```

It must:

1. validate the intent and resolve the goal reference;
2. ask the workspace provider to resolve or prepare a working directory;
3. ask the host to launch the requested agent in that directory;
4. refresh/reconcile the host snapshot;
5. locate the resulting accepted agent without inventing a fake agent;
6. assign it to the requested goal when one was supplied; and
7. return a receipt containing the Observatory agent id when available.

The renderer never runs `git`, `herdr`, a shell command or a provider binary.

### Workspace provider

Workspace selection, Git inspection and worktree preparation belong behind one
narrow capability port. A first-party local Git implementation is enough for
V1. It may internally use Git subprocesses, but those details do not leak to
the coordinator or the Universe.

Recent-location recency is a small control-plane preference, not plugin-owned
semantic state. The core persists it and supplies it to the provider when
building choices; a provider must not write Observatory's SQLite store.

```text
listChoices(query) -> Effect<WorkspaceChoice[], WorkspaceError>
prepare(selection) -> Effect<PreparedWorkspace, WorkspaceError>
```

`PreparedWorkspace` contains a canonical path and sanitized repository,
branch and worktree facts. It does not become an AO goal or a map node.

This is a plugin-capability seam at the control-plane edge. A later provider
could support another VCS, a remote checkout or a Superlogical workspace
without changing the Universe or renderer.

### `SessionHost` launch capability

`SessionHost` remains the only host seam. Its existing snapshot/access/terminal
operations stay intact; launch is added as a capability with an explicit
unsupported result for hosts that cannot provide it.

```text
listLaunchOptions() -> Effect<HostLaunchOption[], HostError>
launch({
  workingDirectory,
  agentKind,
  agentName?,
  args?,
  prompt?,
  requestId
}) -> Effect<HostLaunchResult, HostError>
```

The Herdr adapter hides the concrete host sequence: create/open the Herdr
execution container, create a pane in the prepared working directory, start
the recognized agent, and send the initial prompt. Git worktree preparation
remains the workspace provider's responsibility. The adapter returns an opaque
host receipt/native identity; Herdr workspace, tab and pane ids never enter
Universe types or renderer interfaces.

The mock adapter implements the same capability with deterministic synthetic
agents so the whole coordinator can be tested without Herdr.

### Universe ownership

The host launch is not itself a trusted Observatory agent record. The
coordinator only assigns an agent after reconciliation observes it. If the
host launch succeeds but reconciliation is delayed, the result is `pending`
and the UI shows a launch diagnostic; it does not create a phantom map node.

Goal creation and host launch are not one distributed transaction. If a caller
asks for a new goal and the host launch fails, the goal may remain as an
intentional empty goal with a clear failure message. The coordinator must never
claim that a process exists when the host did not confirm it.

## Agent and orchestrator contract

The agent-facing contract is Observatory's `StartAgent` operation, not a
Herdr recipe. A chief-of-staff agent can request:

```text
start agent
  goal: existing "Observatory"
  project: recent "ao"
  workspace: new worktree, branch "feat/agent-launch"
  agent: claude
  prompt: "Implement the launch wizard"
```

Observatory then performs the host-specific work and returns the agent id,
goal id, workspace path and any warnings. This removes the double operation
you identified: the orchestrator asks once; the Herdr adapter talks to Herdr
internally.

Direct Herdr remains a compatibility path, not the preferred agent contract:

- vanilla agents are discovered normally;
- they can be assigned manually from the inbox; and
- an optional future `agent link` command can associate an externally-created
  host agent when a caller already owns its opaque identity.

The link command must not be required for agents created through Observatory.

Agent launch policy is explicit:

- **manual:** create a proposal/inbox item and wait for human confirmation;
- **auto:** launch immediately within configured workspace and agent limits;
- **hybrid:** launch allow-listed requests, propose the rest.

The TUI's human-created launches are immediate actions. Completion, archive and
other semantic lifecycle mutations retain their existing human-control policy.

## Native agent UI and attachments

Starting an agent through Observatory does not make Observatory a replacement
for every provider TUI. The embedded surface is a host-owned PTY rendered by
OpenTUI, not Claude Code, Codex, OpenCode or PI's native client. It can preserve
normal terminal keys, text input, resize and ordinary terminal paste, but it
cannot promise provider-specific UI features.

Image and file input is the first important example. A native client may rely on
an OS file picker, a terminal emulator's image/clipboard protocol, or a
provider-specific attachment command. Those capabilities do not automatically
survive a byte-oriented PTY stream, and Observatory must not pretend that a
successful paste means an image was received.

The V1 policy is therefore:

- guarantee text and normal terminal interaction in the embedded surface;
- do not add a universal `SendImage` or `UploadFile` method to `SessionHost`;
- expose only capabilities that the host/provider combination can prove, with
  provenance and an explicit unsupported result; and
- retain a capability-gated **native handoff** escape hatch for operations that
  genuinely require the provider's own UI or terminal emulator. Handoff is an
  exception path, not a second default interaction mode.

The TUI exposes the embedded terminal with `t` or `Enter`. When an agent
reports `native-handoff`, `o` temporarily suspends Observatory and invokes the
host's opaque native target, then restores the Observatory selection on return.
If the capability is absent, Observatory explains that the embedded terminal is
the supported surface instead of guessing from the provider name.

Provider plugins may later translate a local file reference or image into a
provider-native interaction. That belongs behind a narrow provider capability
port, not in the Universe or the generic terminal renderer. Until such a
plugin exists, the inspector should say plainly that image upload is available
only in the native client and preserve the agent selection when the user
hands off.

## Failure and recovery

Every step reports its own provenance and can fail without weakening accepted
state:

- invalid or inaccessible path: no host call;
- dirty/shared checkout warning: require explicit confirmation or worktree;
- worktree collision: no host call;
- worktree created, host launch failed: preserve it and offer cleanup;
- host launch accepted, no matching snapshot yet: return `pending` and retry
  reconciliation;
- host launch accepted, agent disappears: retain only the host's normal stale
  observation rules; do not invent an agent;
- duplicate request id: return the existing receipt rather than launching a
  second process when Observatory has enough evidence; and
- unavailable host: preserve the Universe and report the launch as unavailable.

For live Herdr diagnosis, set `AO_LAUNCH_LOG` to an NDJSON file before starting
Observatory, for example `AO_LAUNCH_LOG=/tmp/observatory-launch.ndjson bun run
dev`. The trace records launch steps, pane ids, retry attempts, exit codes and
bounded host errors; it never records prompts, terminal output or transcripts.

## V1 acceptance slice

The first proof should be deliberately narrow:

1. From the TUI, choose a recent project and launch Codex or Claude in an
   existing checkout.
2. Repeat with a new Git worktree and a user-specified branch.
3. Assign the launched agent to the selected goal and select it on the map.
4. Open its embedded terminal with `Enter` and return to the map.
5. Run the same flow through `observatory agent start --json` or an agent
   skill using one request.
6. Verify the agent caller receives the Observatory agent id without needing
   a second Herdr registration call.
7. Exercise invalid paths, dirty checkouts, branch collisions, host failure and
   delayed reconciliation through deterministic mock tests.
8. Confirm direct vanilla Herdr agents remain discoverable and manually
   assignable.

The maintained local web client now covers steps 1–4 through a loopback launch
gateway. It lists choices from `WorkspaceProvider` and `SessionHost`, accepts a
bounded `StartAgent` request, delegates the full operation to
`StartAgentCoordinator`, and returns the refreshed portfolio. The browser does
not run Git or host commands and never receives Herdr-native identifiers.

The slice is successful when starting work feels like a single Observatory
decision while the underlying host and workspace mechanics remain replaceable.

## Deliberate non-goals

- Observatory does not become a general shell/process supervisor.
- Worktrees are metadata and launch context, not another map topology layer.
- The first wizard is not a full IDE file browser.
- The API does not expose Herdr pane, tab or workspace concepts.
- There is no transcript ingestion or universal chat client in this slice.
- Exactly-once process creation across an abrupt host crash is not promised.
- A daemon or remote control plane is deferred until concurrent clients justify
  it.
