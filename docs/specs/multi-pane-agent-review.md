# Multi-pane Agent review workspace

Status: initial multi-pane file, source, diff, evidence and terminal slice implemented; ergonomics under iteration

Updated: 2026-09-04

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Browser terminal interaction](../design/terminal-interaction.md)
- [Agent repository status and code-host plugins](agent-repository-and-code-host-plugins.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)
- [Observatory feature roadmap](observatory-feature-roadmap.md)

## Decision

Make a selected-Agent, multi-pane review workspace the next product slice.
Observatory must let an operator browse the Agent's bounded repository view,
read source files and inspect working-tree changes without leaving the product.
Repository, provider, check and pull-request evidence remain available alongside
the code. The host-owned terminal is persistently visible on the left as the
feedback surface; files, changes and evidence occupy the right review region.

```text
Atlas / Ledger / Needs you / Catch up
                    |
                    v
          selected Agent workspace
   +-------------------+----------------------------+
   | Terminal/feedback | Files, changes or evidence |
   |                   | one full-width surface     |
   +-------------------+----------------------------+
```

This strengthens Observatory's verification workflow. It is not an IDE project:
the first slice is read-only, has no editor, language server, arbitrary shell
execution, merge action or provider conversation UI.

## Why this is core

Provider completion means only that a response or process stopped. A reviewer
must inspect what actually changed, understand the surrounding code and compare
that work with independently observed checks and integration evidence before
accepting an Agent or Goal outcome.

The existing workspace review renders one vertical series of changed-file diffs.
It does not provide repository navigation or unchanged source context, and large
change sets require substantial scrolling. The terminal can recover that
context, but doing so makes Observatory a launcher rather than the place where a
supervisory decision is made.

The review workspace should answer:

1. Which files changed, and how?
2. What does the current file contain outside the changed hunks?
3. What was the file at the current `HEAD` baseline?
4. Are changes local, checked, published, reviewed and mergeable?
5. Is the evidence fresh enough to make a decision?
6. When is terminal intervention still required?

## Product boundary

The review workspace is one supporting lens over an accepted Agent. Files,
repositories, branches, worktrees and pull requests remain Agent metadata and do
not become durable topology.

The surface is read-only in this slice. It may lead to existing human commands,
such as accepting completion or archiving, only when those commands already
exist and their current semantics remain explicit. Repository or provider facts
never invoke a semantic command automatically.

The workspace does not:

- edit, create, rename or delete files;
- stage, commit, push, merge or resolve conflicts;
- run checks or arbitrary commands;
- ingest CI logs, PR comments or arbitrary remote files;
- infer that passing checks or an empty diff completes an Agent or Goal;
- expose an arbitrary filesystem browser;
- turn repositories or files into Atlas nodes; or
- replace the Agent's native terminal or editor.

## Primary workflows

### Review a returned result

1. Select a review candidate from Needs you, Catch up, Atlas or Ledger.
2. Open Review with **Changes** selected.
3. Read the change summary and verification evidence.
4. Move through each changed file and inspect its diff.
5. Toggle to the current source when surrounding context is required.
6. Inspect checks, pull-request state and integration warnings.
7. Use the adjacent terminal to run or request work that the read-only surface
   cannot perform.
8. Accept, revise, close or leave the work pending through explicit human action.

### Browse surrounding code

1. Switch the right review region from **Changes** to **Files**.
2. Search or expand the full-width bounded repository tree.
3. Select a text file and drill into its full-width current worktree content.
4. If the file changed, toggle between **Source**, **Diff** and **Baseline**.
5. Return to the previous changed file without losing tree expansion or scroll
   state.

### Review while an Agent is active

1. Open the current bounded review snapshot.
2. Continue reading without silent content replacement while the Agent writes.
3. When the snapshot becomes stale, show that newer workspace state exists.
4. Refresh explicitly and preserve the selected path when it still exists.
5. Never combine an old change summary with newly read file content as though
   they were one coherent observation.

### Intervene from review

1. Use the persistent left-hand terminal while keeping the selected file or diff
   visible on the right.
2. Submit feedback through the same host-owned terminal contract as the existing
   terminal deck.
3. Resize the terminal/review boundary when interaction or code needs more room.
4. Refresh review explicitly to observe subsequent changes.

## Information architecture

The review workspace is a full-window modal or equivalent top-level transient
surface over the current portfolio. Opening and closing it preserves Atlas
camera, System scope, active lens and selected Agent.

```text
+------------------------------------------------------------------------+
| Agent · repository · branch   Changes Files Evidence   Diff Refresh x |
+---------------------------+------------------+-------------------------+
| Persistent terminal       | One right-hand review surface                |
|                           | Changes, Files or Evidence                    |
|                           | file content replaces the Files browser      |
+---------------------------+-----------------------------------------------+
```

The regions have distinct responsibilities:

1. **Terminal/feedback** keeps the exact Agent interaction visible.
2. **Changes** uses the full review width for diffs.
3. **Files** uses the full review width for browsing, then drills into source.
4. **Evidence** uses the full review width for verification facts.

Terminal and review are peers. Neither requires leaving or covering the other.

## Workspace header

The compact persistent toolbar shows:

- Goal and Agent names;
- repository display identity, branch and short `HEAD` where available;
- review snapshot age and stale/partial state;
- total changed files, additions and deletions in Changes mode;
- explicit Refresh;
- close; and
- right-review controls for Changes, Files and Evidence.

These controls share one toolbar rather than stacking title, tabs and summary
rows. The application masthead and Terminal deck use the same compact control
scale so opening either Terminal alone or Review preserves working height.

The header does not imply integration readiness from one green indicator.
Provider outcome, working tree, checks, pull request and human acceptance remain
separate claims.

## Right review surfaces

### Changes mode

Changes is the default when the working tree has changes. It uses the full right
review width rather than retaining a separate file navigator. The vertically
stacked changed-file overview provides deterministic repository-relative
navigation and exposes status, additions/deletions, binary, oversized,
truncated and unavailable indicators. Files start collapsed so the overview
remains scannable; the operator expands only the diffs they need. Selecting or
linking to one changed file may drill into its full-width diff; Back returns to
**All changes**.

If the working tree is clean, Changes explains that no changes were observed and
no file is selected implicitly from stale data.

### Files mode

Files presents a full-width bounded repository tree assembled from Git-tracked
files and non-ignored untracked files. Selecting a regular file replaces the
browser with a full-width Source/Baseline view; Back returns to the repository
tree. Files does not retain a permanent tree/source split. It excludes Git internals, ignored build output and
paths outside the trusted worktree. In particular, `.git` contents are never
listed even when `.git` is a file in a worktree.

Each entry includes:

- opaque browser-safe file identifier;
- display name and repository-relative hierarchy;
- directory or regular-file kind;
- direct file change status when present;
- aggregate changed-descendant marker for directories;
- text, binary, oversized, symlink or unavailable indication when known; and
- stable ordering with directories before files.

Tree expansion is renderer-local. The initial expansion reveals changed paths
and the selected path, not the entire repository. Very large trees are paged or
pruned with an explicit incomplete marker rather than silently omitted.

### Search

Filename/path search is local over the bounded returned index in the first
slice. It:

- searches repository-relative display paths only;
- returns files, not arbitrary content matches;
- preserves change badges;
- is capped and reports when the index itself is incomplete; and
- never causes an unbounded filesystem search from browser input.

Content search is a separate future decision.

## Primary review pane

### Open-file tabs

The pane supports a bounded number of renderer-local tabs. Tabs represent a
file identity within the current review snapshot, not a durable Observatory
record. Opening beyond the bound evicts the least-recent unpinned tab.

Tabs show filename, change status and stale/unavailable state. Closing a tab does
not change the repository. Refresh attempts to retain tabs whose file identities
still resolve and labels removed or renamed paths honestly.

Tabs and their source/diff mode may be kept in versioned browser preferences,
but do not enter Universe or SQLite.

### Source mode

Source displays the current bounded worktree content with:

- line numbers;
- syntax highlighting from a bounded language hint;
- horizontal scrolling without forced wrapping by default;
- text selection and copy;
- file size, truncation and encoding status; and
- no editing affordance.

The renderer treats file content as untrusted text. Syntax highlighting must not
interpret raw HTML, execute links or load referenced resources.

Deleted files have no current Source and direct the operator to Baseline or
Diff. Binary, symlink, oversized and unavailable files receive explicit states
instead of lossy text decoding.

### Baseline mode

Baseline displays the file at the review snapshot's current Git `HEAD`:

- added and untracked files have no baseline;
- deleted files may have only a baseline;
- renamed files resolve the old path recorded by Git evidence;
- a missing or shallow baseline is unavailable, not an empty file; and
- baseline content follows the same bounds and rendering rules as Source.

V1 compares the worktree to `HEAD`. Choosing a base branch, merge base, commit or
pull-request revision is later work and must be explicit when introduced.

### Diff mode

Diff reuses the maintained diff renderer and supports:

- unified and split presentation;
- line numbers and additions/deletions;
- collapsed unchanged regions with an explicit count;
- expansion of bounded context around a hunk;
- renamed, copied, added, deleted and untracked files;
- binary and oversized explanations; and
- All changes versus selected-file views.

The default is unified diff for width and readability. Split preference is
renderer-local. Diff context expansion must use content from the same accepted
review snapshot or request a refreshed snapshot; it must not splice a current
file into stale hunks.

### Mode availability

| File state             | Source           | Diff             | Baseline           |
| ---------------------- | ---------------- | ---------------- | ------------------ |
| unchanged tracked file | yes              | no               | optional/same      |
| modified file          | yes              | yes              | yes                |
| added file             | yes              | yes              | no                 |
| untracked file         | yes              | yes when textual | no                 |
| deleted file           | no               | yes              | yes                |
| renamed/copied file    | yes when present | yes              | yes when available |
| binary/oversized file  | metadata only    | summary only     | metadata only      |

Unavailable modes remain visible only when their disabled explanation helps the
reviewer understand the file state. Otherwise the UI selects the most useful
available mode: Diff for a changed file and Source for an unchanged file.

### Navigation and scroll

- Previous/next changed-file actions follow navigator order.
- Selecting a file restores its last renderer-local mode and scroll position.
- Switching Source/Diff/Baseline keeps the nearest meaningful line when a safe
  mapping exists; otherwise it starts at the first hunk or line.
- Refresh preserves selection by stable repository-relative identity where
  possible and announces rename/removal.
- Browser Back or Escape closes nested file focus before closing the entire
  workspace on narrow layouts.

## Review evidence

The **Evidence** tab replaces the file navigator and code surface on the right
while leaving the terminal visible. It composes existing selected-Agent facts:

1. provider-reported response outcome and age;
2. working-tree state and review snapshot completeness;
3. independently observed local checks when available;
4. pull-request, CI, review, mergeability and head-sync evidence;
5. integration and cross-Agent overlap warnings when implemented; and
6. human Agent/Goal completion and archive state.

No column fills another. The panel should explain missing, stale, unavailable
and conflicting evidence rather than calculate one opaque readiness score.

Evidence refresh may use a separate source and observation time from file
review. The UI labels those times independently and does not imply one atomic
snapshot across Git, provider and code-host systems.

## Persistent terminal

Terminal uses the existing `SessionHost` capability and web terminal gateway.
It remains mounted on the left and must preserve:

- fresh Agent access validation;
- host-owned PTY, scrollback, input, resize and release;
- linked terminal tabs;
- Agent switching rules;
- explicit unavailable and conflict behavior; and
- renderer-local review selection and scroll state.

Terminal activity does not refresh review automatically. The operator chooses
Refresh after intervention so the transition is visible and deliberate.

### Pane resizing

On wide screens, the Terminal/review boundary is resizable within bounded
minimum and maximum widths. Changes, Files and Evidence do not add nested pane
boundaries. Double-clicking the divider restores the default.

Terminal width is a versioned browser preference. They are not trusted state and
may reset safely after schema change.

## Responsive behavior

The maintained desktop/browser experience uses three responsive states:

- **Wide:** Terminal and one full-width right review surface remain visible.
- **Medium:** Terminal stays left while the active review surface retains the
  remaining width.
- **Narrow:** terminal and review remain adjacent at bounded minimum widths in
  the initial desktop-oriented implementation; a later measured mobile workflow
  may introduce explicit surface switching.

The responsive transition never discards selected file, mode or review
snapshot. Horizontal code scrolling is preferable to shrinking text below the
maintained readable size.

## Keyboard and accessibility

All review functionality is available without pointer input.

Required behavior:

- tab order follows header, terminal and the active right review surface;
- tree entries expose correct tree/treeitem expansion semantics;
- changed files expose status in text, not colour alone;
- arrow keys traverse the focused tree or changed-file list;
- Enter opens the focused file;
- a discoverable shortcut moves to previous/next changed file;
- Escape closes transient menus/drawers before the workspace;
- pane dividers are keyboard-resizable separators;
- Source and Diff are labelled regions with line numbers excluded from copied
  source where practical;
- loading, stale, truncated and refresh results are announced through bounded
  live regions; and
- reduced motion does not alter information or focus order.

Exact shortcuts must avoid collisions with Atlas, terminal and browser defaults
and belong in the existing keyboard guide.

## Trusted review module

Introduce one deep read-only module rather than separate pass-through tree and
file readers. The web composition edge resolves an accepted Agent to its trusted
worktree; the module owns Git indexing, root confinement, snapshot consistency,
bounded file reads and diff assembly from that point onward.

```ts
interface WorkspaceReviewReader {
  inspectWorkspace(path: string, now: number): Effect<WorkspaceReviewSnapshot, WorkspaceError>;
  readWorkspaceReviewFile(
    request: WorkspaceReviewFileRequest,
    now: number,
  ): Effect<WorkspaceReviewFileSnapshot, WorkspaceError>;
}
```

The browser supplies only accepted Agent and opaque snapshot/file IDs. The web
gateway injects the current trusted worktree and never accepts an absolute or
repository-relative filesystem path from browser input.

The module replaces the old browser `/api/diff` gateway rather than eliminating
`WorkspaceDiffReader`: repository-status evidence still uses that internal
local-diff interface. Diff parsing and bounded command implementation remain
shared inside the workspace adapter. `AgentRepositoryStatusReader` stays
separate because it composes local and remote evidence with a different
freshness and cost model.

### Review snapshot

```ts
interface AgentWorkspaceReviewSnapshot {
  readonly kind: "agent-workspace-review";
  readonly snapshotId: string;
  readonly agentId: AgentId;
  readonly generatedAt: number;
  readonly status: "complete" | "partial" | "unavailable" | "not-git";
  readonly repository?: string;
  readonly branch?: string;
  readonly head?: string;
  readonly revision: string;
  readonly changes: AgentWorkspaceChangeSummary;
  readonly tree: readonly AgentWorkspaceTreeEntry[];
  readonly treeComplete: boolean;
  readonly diagnostics: readonly string[];
}
```

`snapshotId`, `revision` and file handles are opaque outside the module. They do
not expose a worktree path or Git internals. Diagnostics are bounded categories
and never include file contents, command output or sensitive paths.

### Tree entries

```ts
interface AgentWorkspaceTreeEntry {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly kind: "directory" | "file" | "symlink";
  readonly change?: WorkspaceDiffFileStatus;
  readonly changedDescendants: number;
  readonly contentKind?: "text" | "binary" | "oversized" | "unknown";
}
```

The hierarchy uses identifiers and display names. A browser cannot turn a name
or concatenated hierarchy into a file request.

### File request and result

```ts
interface AgentWorkspaceFileRequest {
  readonly agentId: AgentId;
  readonly snapshotId: string;
  readonly fileId: string;
  readonly view: "source" | "baseline" | "diff";
}

interface AgentWorkspaceFileSnapshot {
  readonly kind: "agent-workspace-file";
  readonly snapshotId: string;
  readonly fileId: string;
  readonly displayPath: string;
  readonly view: "source" | "baseline" | "diff";
  readonly status: "available" | "stale" | "missing" | "binary" | "oversized" | "unavailable";
  readonly language?: string;
  readonly content?: string;
  readonly hunks?: readonly string[];
  readonly truncated: boolean;
  readonly generatedAt: number;
  readonly message?: string;
}
```

The final implementation may use a bounded line model instead of returning one
large content string, but it must retain the same file-level interface and
failure semantics.

## Snapshot and freshness semantics

The worktree may change continuously. Observatory does not copy or freeze the
repository merely to provide review.

`open` computes an opaque review revision from the exact bounded Git/index state
used for its tree and change summary. `readFile` revalidates:

- accepted Agent and current trusted worktree binding;
- canonical real repository root;
- snapshot ownership and expiry;
- file handle membership;
- current `HEAD`; and
- enough bounded worktree state to determine whether the snapshot remains
  coherent.

If relevant state changed, `readFile` returns `stale` rather than mixing current
content with an older diff. The UI offers Refresh and does not retry silently.
A refreshed snapshot may preserve selected display identity, but the server
issues new opaque handles.

A partial Git index, truncated diff or capped tree cannot claim completeness.
The snapshot may still expose safely observed files with explicit partial state.

Review snapshots and handle maps are bounded process-local capabilities with an
expiry. They are not persisted. A process restart invalidates them and the
browser opens a fresh snapshot.

## Index and content acquisition

For a Git workspace, the first implementation derives the file index from:

- tracked files; and
- non-ignored untracked files.

It does not recursively list arbitrary filesystem content. Ignored dependency,
build, cache and credential files stay excluded unless they are tracked. Git
internal paths are always excluded.

Source reads use filesystem content only after canonical root confinement.
Baseline reads use structured Git argument vectors for the exact accepted
`HEAD` and path. Diff reads compare the accepted worktree snapshot to `HEAD` and
reuse the existing parser and renderer contract.

All commands and streams have deadlines and hard output bounds. A bound breach
produces partial, oversized or unavailable state and never a clean result.

## Root confinement and path safety

The review module must:

1. resolve the accepted Agent's worktree server-side;
2. canonicalise the repository root;
3. reject a changed or missing trusted worktree binding;
4. derive entries only from bounded Git output;
5. validate repository-relative paths internally;
6. resolve and revalidate the target immediately before reading;
7. reject any target outside the canonical root;
8. never follow a symlink in V1, even when it points inside the root;
9. reject directories, devices, sockets and other non-regular content; and
10. keep concrete worktree paths out of normal browser responses and logs.

Files changed between validation and read remain subject to normal local race
conditions. Open by file descriptor where practical, then verify regular-file
metadata and enforce the byte cap while streaming. A race or mismatch returns
stale/unavailable rather than content from an unproved target.

## Bounds

Kernel-owned hard limits apply to:

- tree entries and depth;
- changed files and diff bytes;
- file bytes and rendered lines;
- open review snapshots globally and per browser;
- file handles per snapshot;
- open renderer tabs;
- diagnostics and display-path length;
- command output and stderr;
- acquisition deadlines; and
- refresh frequency.

Defaults should be chosen from realistic repositories and measured browser
performance. Plugins and browser callers cannot increase hard limits. Truncation
is visible at the affected tree, file or diff level.

## Web gateway

Add a narrow review gateway; do not expand the general Universe command route.
Conceptually:

```text
GET /api/review?agentId=...&refresh=0|1
GET /api/review/file?agentId=...&snapshotId=...&fileId=...&view=source|baseline
```

Diff views use the bounded hunks already returned in the review snapshot, not a
second file read.

The exact path shape may change, but the browser contract remains:

- Agent ID is the only durable target supplied by the browser;
- snapshot and file identifiers are server-issued capabilities;
- no filesystem path, repository root or Git revision is accepted from the
  browser;
- responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`;
- loopback authority and Origin rules protect reads from DNS rebinding;
- refresh is rate-bounded and does not mutate semantic state; and
- expected stale/expired handles map to typed conflict responses rather than
  generic server errors.

Repository integration evidence continues through the existing repository
status gateway so its cache and plugin failures remain independent.

## Browser state

Renderer-local review state includes:

- active Changes/Files/Evidence mode;
- selected file and Source/Diff/Baseline mode;
- expanded tree directories;
- open file tabs and tab order;
- per-file scroll position;
- unified/split preference;
- Terminal width; and
- filename search query.

Agent identity, Goal assignment, repository evidence and review snapshots do not
become renderer-authored state. Browser preferences may retain presentation
settings, but a refresh or invalid handle always yields to the server's current
trusted snapshot.

## Loading and failure behavior

The shell remains stable while individual panes load.

- **Initial load:** show skeletons in Navigator and primary review; Evidence may
  load independently.
- **Tree failure:** retain available change summary and Evidence; explain that
  Files is unavailable.
- **File failure:** retain tree selection and other tabs; show a typed file-level
  explanation.
- **Diff failure:** never substitute Source while labelling it Diff.
- **Evidence failure:** retain local review and show unavailable provider facts.
- **Terminal failure:** retain review exactly where it was.
- **Snapshot stale:** keep the old rendered content visibly marked stale until
  the operator refreshes or closes it; disable mixing in new file reads.
- **Agent archived or execution lost:** review may remain available from the
  trusted worktree; terminal capability degrades independently.
- **Worktree missing or rebound:** invalidate all review handles and require a
  fresh trusted open.

No review failure mutates Agent, Goal or host state.

## Security and privacy

- File content is fetched only on explicit selected-Agent review actions.
- There is no portfolio-wide file indexing or content persistence.
- Source and diffs are excluded from logs, diagnostics, projections and SQLite.
- Browser responses are bounded and same-origin loopback only.
- Remote URLs and credentials remain governed by repository-status redaction.
- Syntax rendering treats content as text and applies a restrictive link policy.
- Source maps, generated assets and ignored secrets are not included unless
  tracked and explicitly selected from the returned bounded index.
- Clipboard operations remain explicit browser actions.
- Fixtures are synthetic and contain sentinel secrets that tests prove absent
  from logs and diagnostics.

The local operator is allowed to inspect their selected worktree, but that does
not justify arbitrary path access from browser inputs.

## Architecture placement

```text
web ReviewWorkspace
       |
       v
WebAgentReviewGateway
       |
       v
AgentWorkspaceReviewReader
  +--> trusted Agent/worktree resolution
  +--> bounded Git index and diff
  +--> confined source and baseline reads
  +--> process-local snapshot capabilities

Right Evidence tab --> AgentRepositoryStatusReader / inspector projections
Left Terminal pane --> SessionHost through existing WebTerminalGateway
```

`universe/`, `attention/`, `spatial/` and persistence remain unchanged. The
review reader is Effectful at its filesystem/process edge. Its serialisable
results are immutable evidence snapshots; renderer calculations over them are
pure.

No repository browser interface is added to `SessionHost` or an agent harness.
Workspace review belongs to the workspace/repository edge and remains useful
when no Agent execution is live.

## Implementation record

The initial implementation now provides:

- a full-window workspace with a persistent left Terminal and right-hand
  Changes, Files and Evidence review;
- All changes and selected-file diff views with unified/split presentation;
- a bounded tracked/non-ignored repository tree with changed ancestor markers
  and filename filtering;
- Source, Diff and Baseline modes through process-local opaque snapshot and file
  handles;
- explicit stale, partial, binary, oversized, missing and unavailable states;
- independent repository/PR evidence and a host-owned feedback Terminal;
- root-confined reads that reject symlinks and never accept browser paths; and
- server, reader, renderer, typecheck and production-build coverage.

The current iteration includes a persistent left-hand Terminal and a dedicated
right review region. One compact toolbar combines review identity, modes,
summary and actions; compact application and Terminal chrome preserve the same
content-first density outside Review. The Terminal/review boundary is pointer-
and keyboard-resizable with a bounded, browser-persisted width; the right side
has no nested split. The implementation still uses one selected file rather than bounded
open-file tabs and a flat bounded index returned at open rather than paged tree
acquisition. Source and diff surfaces now use bounded lowlight syntax tokens,
with explicit path-to-language aliases and escaped React text rendering.
Collapsed files do not initialize diff rendering, only the active unified or
split layout is built, and large source files fall back to plain escaped text.
Snapshot reads validate and read one file descriptor, then recheck freshness so
concurrent writes become stale rather than mixed content. The obsolete browser
`/api/diff` route has been removed.
Those are iteration work, not hidden claims of the current implementation.

## Implementation slices

### Slice 1: multi-pane shell and selected diff

- Replace the current single stacked review modal with the resizable shell.
- Add Changes navigator, All changes and selected-file views using existing
  `WorkspaceDiffSnapshot` data.
- Add Source/Diff/Baseline toggles for changed files where existing bounded
  content is sufficient.
- Present repository verification summary in the right-hand Evidence tab.
- Mount the existing Terminal deck persistently on the left.
- Preserve selection, Atlas camera and scroll state while using Terminal.

Gate: an operator can review a multi-file change one file at a time, inspect
surrounding changed-file source and submit terminal feedback without losing
place.

### Slice 2: deep review module and repository tree

- Introduce `AgentWorkspaceReviewReader` and remove the web composition root's
  direct `WorkspaceDiffReader` coordination.
- Add bounded tracked/non-ignored file indexing and opaque snapshot/file handles.
- Add confined Source and Baseline reads.
- Add Files navigator, changed-descendant markers and filename search.
- Add stale-snapshot and process-restart behavior.

Gate: the browser can inspect any returned regular text file but cannot name or
read a path that the server did not issue, including symlink escapes.

### Slice 3: review ergonomics

- Add bounded open-file tabs, per-file scroll restoration and previous/next
  changed navigation.
- Add collapsed unchanged context and bounded expansion.
- Add keyboard tree navigation, pane resizing and responsive drawers.
- Persist only versioned presentation preferences.

Gate: realistic large reviews remain navigable by keyboard and at supported
viewport widths without loading the whole repository or all file contents.

### Slice 4: verification integration and dogfood

- Present provider outcome, local Git, checks, PR and human acceptance as
  independent evidence.
- Link Needs-you review candidates directly to the relevant Agent workspace.
- Exercise active-write refresh, host loss, missing worktree, partial index and
  ambiguous PR scenarios through the mock host and disposable repositories.
- Record whether review avoids terminal or external-editor handoff.

Gate: the operator can make a supported accept/revise/leave-pending decision
without treating runtime completion as verified completion.

## Testing strategy

### Review module

- tracked, modified, staged, untracked, deleted, renamed and copied files;
- clean, non-Git, missing and inaccessible worktrees;
- partial Git output, command timeout and output truncation;
- text, invalid UTF-8, binary, empty, oversized and changing files;
- baseline presence and absence for every file status;
- ignored paths and `.git` exclusion;
- absolute, traversal, separator, symlink and race attempts;
- snapshot expiry, wrong Agent, wrong snapshot and stale revision;
- bounded tree depth, count, content and diagnostics; and
- no file content in logs, errors or persistence.

### Web gateway

- accepted Agent lookup and missing Agent rejection;
- no browser-supplied filesystem paths or revisions;
- opaque handle ownership and expiry;
- loopback authority, Origin, no-store and nosniff behavior;
- typed partial, stale, binary and oversized responses;
- refresh rate bounds; and
- no imports from concrete workspace, host or persistence adapters in the
  browser.

### Renderer

- All changes and selected-file modes;
- Source/Diff/Baseline availability matrix;
- tree expansion, search, changed ancestors and truncation;
- open tabs, eviction and refresh preservation;
- independent Evidence and Terminal failures;
- stale snapshot without silent content replacement;
- keyboard traversal, focus restoration and accessible status labels;
- wide, medium and narrow layouts; and
- Atlas camera and selection preservation after close.

### Live smoke

Use a disposable Git worktree and disposable Agent to exercise:

1. review while the Agent changes a file;
2. stale notification and explicit refresh;
3. source, baseline and diff for modified/added/deleted files;
4. terminal open, intervention, close and refresh;
5. Agent process exit while review remains available; and
6. cleanup with no retained source content or review handles.

## Acceptance criteria

The slice is complete when:

1. an accepted Agent with a trusted worktree opens one coherent review workspace;
2. the operator can browse a bounded repository tree and read returned text
   files without supplying filesystem paths;
3. every changed textual file supports the truthful subset of Source, Diff and
   Baseline modes;
4. All changes remains available for rapid overview;
5. provider, repository, check, PR and human evidence remain visibly separate;
6. Terminal remains visible and can be resized without losing review state;
7. active workspace changes produce stale/refresh behavior rather than mixed
   snapshots;
8. binary, oversized, partial and unavailable states are explicit;
9. root confinement, symlink rejection and content redaction tests pass;
10. review state does not enter Universe topology or semantic persistence; and
11. `bun run format`, `bun run check` and `bun test` pass.

## Later opportunities requiring evidence

- line-level review comments stored as human review state;
- send selected file/line context through a future structured conversation
  capability;
- explicit check execution through a narrow workspace capability;
- base-branch, merge-base, commit and pull-request comparison modes;
- cross-Agent file overlap and integration conflict overlays;
- image and other safe binary previews;
- open selected file in a configured external editor; and
- code-host review submission.

Editing, staging, committing, merging and arbitrary command execution require
separate product decisions. They must not enter this slice merely because the
layout resembles an IDE.

## Rejected alternatives

- **Return arbitrary files from a browser path.** It turns the loopback server
  into a filesystem oracle and bypasses trusted Agent worktree resolution.
- **Put a generic filesystem capability on `SessionHost`.** Process placement
  does not own repository review, and useful review may exist without a live
  execution.
- **Render every repository file eagerly.** It is expensive, privacy-invasive
  and unnecessary for explicit review.
- **Use the terminal as the source viewer.** It loses coordinated navigation,
  evidence and review state and makes behavior shell-dependent.
- **Build editing before review.** It expands into IDE semantics before proving
  the core verification workflow.
- **Collapse evidence into one readiness score.** Independent claims and
  uncertainty are necessary for trustworthy human acceptance.
- **Refresh silently while the Agent writes.** It can combine incompatible
  source, diff and evidence into a misleading review.
- **Persist source snapshots in SQLite.** The provider repository remains the
  source of code; semantic persistence does not need file contents.
