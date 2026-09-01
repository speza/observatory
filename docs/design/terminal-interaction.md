# Observatory browser terminal interaction

Status: accepted web-only V1 implementation decision

Updated: 2026-08-27

Related: [Observatory technical architecture](technical-architecture.md),
[agent and linked execution model](../specs/agent-execution-model.md)

## Decision summary

Observatory renders hosted Agent terminals in the browser with xterm.js. It
does not own the PTY, process, pane scrollback or durable terminal state. Those
remain owned by the configured `SessionHost`; Herdr is the required live V0/V1
host.

The same contract powers linked execution tabs for the selected Agent. A link
may represent an observed shell, a host-prepared shell in the Agent worktree or
a recognised sibling Agent. It is contextual UI, not another Observatory Agent
or a new node in Goal → Agent topology.

The native OpenTUI terminal implementation was retired with the TUI on
2026-08-27. The generic host capability and its adapter tests remain production
architecture; the terminal-cell renderer and native interaction rules do not.

## Ownership model

```text
agent process
    │ bytes and ANSI control sequences
    ▼
SessionHost-owned PTY and pane
    │ generic terminal frames
    ▼
loopback terminal gateway
    │ SSE frames / same-origin actions
    ▼
xterm.js browser surface
    ▼
human
```

| User action              | Observatory sends         | Owner             |
| ------------------------ | ------------------------- | ----------------- |
| Key or paste             | `terminal.input`          | Agent application |
| Resize visible terminal  | `terminal.resize`         | Host PTY          |
| Wheel or PageUp/PageDown | `terminal.scroll`         | Host viewport     |
| Close a terminal tab     | `terminal.release`        | Host controller   |
| Receive output           | `terminal.frame` over SSE | Host → browser    |

Agent input and host scrolling are different capabilities. Sending PageUp or
mouse escape bytes to an Agent cannot reliably browse host scrollback: a
full-screen application may consume them, ignore them or maintain different
internal history. Observatory therefore uses explicit host scrolling when the
host supports it and reports unsupported behaviour honestly otherwise.

## Server boundary

The browser never receives concrete host identifiers. To open a terminal, the
server:

1. resolves the accepted Agent from Universe state;
2. asks `SessionHost` for fresh `AgentAccess`;
3. opens the generic terminal capability;
4. stores a random process-local session handle;
5. streams bounded replay and live frames over SSE; and
6. accepts only narrow same-origin input, resize, scroll and release requests.

The handle is a local capability, not remote authentication. The server binds
to loopback, validates mutation Origin and intent, revalidates linked execution
handles before use, and releases all open sessions during shutdown.

Conceptually, terminal input remains host-neutral:

```ts
type HostTerminalInput =
  | { kind: "text"; value: string }
  | { kind: "bytes"; value: Uint8Array }
  | {
      kind: "scroll";
      direction: "up" | "down";
      lines: number;
      source: "wheel" | "page-key";
      column?: number;
      row?: number;
    };
```

`hosts/types.ts` defines this shape. `hosts/herdr/terminal.ts` maps it to the
Herdr controller protocol and parses frames. Herdr command names, takeover
rules and workspace/pane identities remain inside the adapter.

## Browser presentation

xterm.js interprets terminal bytes and owns transient browser selection,
viewport and input presentation. It does not create a PTY, persist scrollback
or author semantic Observatory state.

Browser key events that traditional terminal encoding cannot distinguish need
an explicit byte mapping at this presentation boundary. Observatory encodes
unmodified `Shift+Enter` as CSI-u `ESC [ 13 ; 2 u`, allowing supporting Agent
applications to distinguish multiline input from ordinary `Enter`. Modified
keys travel through the generic binary-input capability so no text layer can
normalise their control bytes. All other keyboard input continues through
xterm.js as text unchanged. The browser consumes the complete DOM event
sequence for a mapped key and emits terminal bytes only on `keydown`; allowing
the follow-up legacy `keypress` through would also emit ordinary `Enter`.

The terminal deck contains a primary `Main` tab and any selected companion
tabs. Inactive tabs may remain mounted and receive frames; only the active tab
receives ordinary keyboard input, paste and scroll. Opening, switching or
closing tabs must not mutate Atlas selection, camera, inspector or durable
state.

Workspace review opens as a full-width, read-only Git diff. Changed files form
one vertically scrollable series of collapsible sections so review remains
usable when its width is constrained. The human may open the terminal beside
the diff when runtime context is useful and hide it again without leaving the
review. Both are transient views over the same accepted Agent. `resizeMode:
fit` lets the host PTY follow the visible xterm.js dimensions so wrapping stays
faithful.

## Failure and uncertainty rules

- A terminal stream ending closes only that browser session; it does not prove
  that the Agent completed or stopped.
- Host loss preserves the accepted Agent and marks access unavailable or
  uncertain.
- A linked shell that disappears or changes identity must fail closed on fresh
  validation; never reuse a stale opaque target.
- Releasing an existing shell releases Observatory's controller and must not
  silently terminate a user-owned process.
- Unsupported ANSI or host features may degrade the terminal surface, but must
  never change semantic Universe state.
- Provider-specific uploads, image pickers or native UI features do not justify
  turning `SessionHost` into a universal provider API.

## Alternatives rejected

**Browser-local authoritative scrollback:** cannot recover host history that
was never streamed, and diverges easily for alternate-screen applications.

**Injecting PageUp or wheel bytes:** targets the Agent application, not the
host viewport, so behaviour is application-dependent and unacknowledged.

**Observatory-owned PTY or multiplexer:** would make Observatory an execution
runtime and require a separate product decision. Current hosts already own this
responsibility.

**Native TUI fallback:** maintaining a second application client duplicates
interaction and constrains the GUI. Herdr itself remains the terminal-native
fallback for provider-specific or recovery workflows.

## Verification expectations

Terminal changes require:

1. shared host contract coverage for input, scroll, resize and release;
2. exact adapter wire-mapping tests;
3. deterministic mock frame and lifecycle coverage;
4. stale or reused target tests proving no host-control action is started;
5. API tests for loopback capability isolation; and
6. a live, non-destructive browser → host → release smoke where available.
