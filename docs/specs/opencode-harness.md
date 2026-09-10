# OpenCode harness

Status: implemented for CLI/TUI lifecycle; Herdr supplies live status

Date: 2026-09-10

Depends on:

- [Agent harness plugins](agent-harness-plugins.md)
- [Conversation-first Agent tracking](conversation-first-agent-tracking.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)
- [Observatory plugin architecture](../design/plugin-architecture.md)

## Decision

Provide one built-in `agent-harness` definition for the stable OpenCode CLI:

- harness id: `opencode`
- executable: `opencode`
- interactive entrypoint: the OpenCode TUI

The harness owns version-compatible command construction, session catalogue
parsing and exact-session continuity. The selected `SessionHost` owns the TUI
process, PTY, placement, attachment and close lifecycle.

The first slice is CLI/TUI lifecycle support. Herdr supplies live execution
status; OpenCode-native activity and permission evidence remains an optional
future capability at the existing harness observation boundary.

## Goals

- Show OpenCode when its binary is installed.
- Start a genuinely new interactive session in the prepared workspace.
- Discover dormant root sessions through the supported metadata CLI without
  reading transcripts.
- Resume one exact session by its native id within the same local database
  scope.
- Preserve `unknown`, unavailable, partial and contradictory states.
- Reuse the existing launch receipts, conversation catalogue and
  `SessionHost` contract.

## Non-goals

- Starting or supervising an OpenCode server as an Observatory-owned daemon.
- Embedding an OpenCode SDK or HTTP client in Observatory.
- Reading the OpenCode database or session files directly.
- Selecting a session by recency, title, workspace or `--continue`.
- Forking sessions, submitting prompts through a native API, answering
  permissions or exposing OpenCode's model/provider catalogue.
- Making OpenCode subagents or project ids new Observatory topology nodes.

## Upstream facts and assumptions

These facts were checked against OpenCode documentation and source on
2026-09-09. They are compatibility inputs, not Observatory invariants.

- Running `opencode` starts the TUI. The TUI accepts `--session`,
  `--continue`, `--fork` and `--prompt`; `--session` is the exact native
  session selector.
- `opencode session list --format json --max-count N` lists root sessions.
  The catalogue contains bounded metadata such as `id`, `title`, `updated`,
  `created`, `projectId` and `directory`.
- The current CLI returns no stdout when the session list is empty; a
  successful empty response is therefore a valid empty catalogue.
- OpenCode plugins can observe session, permission, message and tool events.
  The observation integration must target one tested plugin API generation at
  a time.

Sources:

- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [OpenCode server](https://opencode.ai/docs/server/)
- [OpenCode plugins](https://opencode.ai/docs/plugins/)
- [OpenCode session-list command](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/session.ts)
- [OpenCode generated session and event types](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)

## Boundary

```text
StartAgentCoordinator
        |
        v
AgentHarness(opencode)
  - availability
  - session catalogue
  - start / exact resume plan
  - continuity proof
        |
        v
AgentProcessPlan { executable: "opencode", args: [...] }
        |
        v
SessionHost.launchExecution(workingDirectory, processPlan)
        |
        v
Herdr TUI process / PTY / terminal
```

No OpenCode identifier, flag, session shape or server type crosses into
`universe/`, `persistence/`, `projection/`, `renderer/` or generic host
interfaces. Outside the plugin, the only provider identity is the existing
opaque `OpaqueNativeConversationRef`.

## Identity and scope

Use the following normalized reference shape for a root session:

```ts
{
  harnessId: "opencode",
  continuityScopeId: stableHash("opencode" + "\u0000" + scopeKey),
  kind: "id",
  value: session.id,
}
```

`scopeKey` is the resolved database path from the read-only command
`opencode --pure db path`. Only its bounded hash is retained or exposed; the
raw path must not appear in diagnostics, fixtures or browser projections.

If the database path cannot be established, `snapshotSessions()` fails as an
unavailable catalogue. The adapter must not invent a scope or silently merge
another installation. An unscoped host observation can be enriched only when
the unscoped id has one unique scoped catalogue match.

`projectId` and `directory` are catalogue metadata only. They are not stable
Observatory identity and must not be used for scope, Goal assignment or map
topology.

## Harness contract

### Availability

Run the bounded probe:

```text
opencode --version
```

Return normalized version output when the command succeeds. A missing
executable, non-zero exit, timeout or malformed result produces
`available: false` with a short provider-neutral message. Do not print stderr,
credentials, config paths or plugin diagnostics.

Availability does not authenticate a model provider. Provider login failures
remain harness runtime evidence and must not make Observatory claim that the
CLI is absent.

### Catalogue

Run the metadata command once for the Observatory process directory and for
each known workspace reference:

```text
opencode --pure session list --format json --max-count <configured-limit>
```

OpenCode's CLI is project-scoped, so Observatory supplies each known
workspace as the child-process `cwd` and merges the bounded root-session
results. It does not read the OpenCode database or start a server. If a
workspace is not known to Observatory, its sessions cannot be discovered
until that workspace is configured, observed on the selected host or
associated with an existing conversation.

Parse only these fields:

| OpenCode field | `ProviderSessionObservation` field | Rule                                                  |
| -------------- | ---------------------------------- | ----------------------------------------------------- |
| `id`           | `nativeConversationRef.value`      | Required, bounded, opaque                             |
| `title`        | `title`                            | Whitespace-normalized and bounded; no prompt fallback |
| `created`      | `createdAt`                        | Finite epoch milliseconds only                        |
| `updated`      | `lastActiveAt`                     | Finite epoch milliseconds only                        |
| `directory`    | `workspaceRef`                     | Absolute path only                                    |
| `projectId`    | —                                  | Never persisted or used for identity                  |

Every accepted row has:

```text
harnessId: "opencode"
providerInstanceId: opencode-local-<scope>
homeSiteRef: "local"
resumeEligibility: same-site | unknown
provenance: provider-index
```

Catalogue rules:

- Successful blank stdout with empty stderr maps to a complete empty catalogue.
- A result at the configured limit is `complete: false`.
- Non-zero exit, timeout, truncation, invalid JSON or invalid required fields
  produce a degraded or unavailable result without deleting stored
  conversations.
- Invalid rows are skipped with a generic count diagnostic. Raw titles, paths,
  prompts and process output are never copied into diagnostics.
- The adapter never opens the database or session files as a fallback.

### New session plan

Use the interactive TUI executable directly:

```text
executable: "opencode"
args: [<validated user flags>]
```

When `request.prompt` is present:

```text
["--prompt", request.prompt, ...validated user flags]
```

Do not allocate a session id. OpenCode owns new-session identity, so the plan
omits `nativeConversationRef` and continuity remains pending until a
provider/host observation reports the generated id.

Reject lifecycle overrides in `request.args`, including `--session`, `-s`,
`--continue`, `-c`, `--fork` and `--prompt`. Also reject an extra positional
project path or an attach/server mode that would override the host-provided
working directory or replace the interactive TUI.

### Exact resume plan

For a saved OpenCode reference of `kind: "id"`:

```text
executable: "opencode"
args: ["--session", nativeConversationRef.value, ...validated user flags]
nativeConversationRef: nativeConversationRef
```

Reject an empty id, a scope mismatch and `--continue`, `-c` or `--fork`. Never
substitute the latest session, create a new session or silently fork when the
exact session is missing.

OpenCode resume-with-prompt is rejected until exact delivery is version-tested.
It must fail closed rather than silently dropping the requested prompt.

### Continuity proof

The harness compares native identity, not process heuristics:

| Evidence                                                               | Result     |
| ---------------------------------------------------------------------- | ---------- |
| Expected scope and native id match observed evidence                   | `same`     |
| Expected id and a different native id are observed                     | `replaced` |
| Expected id has no live target after a complete host snapshot          | `absent`   |
| Host has no exact native identity or launch binding                    | `unknown`  |
| Host reports a different harness                                       | `unknown`  |
| New launch reports the selected harness and exact id for its execution | `same`     |

The harness never treats process name, pane, cwd, title, recency or OpenCode
label as exact identity.

## Herdr evidence prerequisite

The Herdr adapter translates generic host evidence. Exact managed Agent
admission requires the selected host or a host-local integration to report an
OpenCode session identity:

```json
{
  "agent": "opencode",
  "agent_session": {
    "agent": "opencode",
    "kind": "id",
    "value": "ses_<opaque-id>",
    "source": "native-integration"
  },
  "agent_session_restored": false
}
```

If that integration is absent, the adapter asks Herdr for foreground process
argv and accepts only an exact `opencode --session <id>` or equivalent `-s`
selector. Process names, titles, cwd and workspace remain insufficient;
ambiguous or missing selectors stay unknown.

The integration is Herdr's own OpenCode support. Observatory does not install
or manage an OpenCode plugin, TUI setting or extension; operators enable the
host integration and restart running OpenCode panes so exact new-session
identity is reported.

## Optional provider observations

This is Phase 2, not a prerequisite for lifecycle support. The observation
source is configured independently from CLI availability and must distinguish
not-installed, stale, unavailable and healthy.

Each event carries the `opencode` harness id and is delivered through the
existing authenticated loopback ingress. Plugins never write Observatory
storage or call Universe. Raw event payloads, permission titles, prompts and
transcripts are never retained.

Initial safe mappings include:

| OpenCode event              | Observatory observation      |
| --------------------------- | ---------------------------- |
| `session.status` busy/retry | `activity/responding`        |
| `session.idle`              | `activity/idle`              |
| `permission.asked`          | open human-input request     |
| `permission.replied`        | resolved human-input request |
| `session.error`             | coarse failed outcome        |
| `session.compacted`         | completed compaction         |

## Failure and uncertainty policy

| Condition                                      | Harness result        | Observatory action                                        |
| ---------------------------------------------- | --------------------- | --------------------------------------------------------- |
| CLI missing or version probe fails             | unavailable           | Hide from launch choices; retain stored state             |
| Scope probe fails                              | catalogue unavailable | Preserve catalogue; continuity remains unknown            |
| Catalogue truncated or capped                  | incomplete            | Do not mark omitted sessions missing                      |
| Catalogue has invalid rows                     | degraded              | Keep valid rows; report bounded count                     |
| Exact id absent from a complete catalogue      | not resumable         | Mark provider continuity missing; never fall back         |
| Host starts OpenCode without exact id evidence | unknown               | Keep launch pending; no managed admission                 |
| Foreground argv contains exact session id      | proved                | Match scope; bind or rebind the Agent                     |
| Host reports a different exact id              | replaced              | Do not transfer Goal ownership                            |
| Resume exits or errors                         | failed or unknown     | Record failure; do not change the target                  |
| Resume prompt is requested                     | unsupported           | Reject before launch; do not drop the prompt              |
| Observation plugin is absent                   | not-configured        | Keep host/runtime evidence; provider enrichment is absent |

## Acceptance criteria

- The registry loads `opencode` with bounded availability and no new core or
  host seam.
- Catalogue entries become scoped opaque conversations with no transcript
  fields; capped and failed reads remain incomplete or unavailable.
- New plans never carry a provider-generated id or accidental resume flag.
- Resume plans use exactly one supplied id and reject continue/fork ambiguity.
- Same, replaced, absent and unknown continuity outcomes pass shared harness
  contract coverage.
- No Goal is inherited from cwd, pane, title, newest session or process name.
- The host integration, when present, proves a real session id carrying the
  selected harness id.
- `bun run format`, `bun run check` and `bun test` pass, followed by mock and
  live smoke evidence.
