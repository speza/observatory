# Observatory browser terminal interaction

Status: accepted web-only V1 implementation decision

Updated: 2026-09-03

Related: [Observatory technical architecture](technical-architecture.md)

## Decision summary

Observatory renders hosted Agent terminals in the browser with xterm.js. It
does not own the PTY, process, pane scrollback or durable terminal state. Those
remain owned by the configured `SessionHost`; Herdr is the required live host.

The same contract powers linked execution tabs for the selected Agent. A link
may represent an observed shell, a host-prepared shell in the Agent worktree or
a recognised sibling Agent. It is contextual UI, not another Observatory Agent
or a new node in Goal → Agent topology.

## Ownership model

```text
agent process
    │ bytes and ANSI control sequences
    ▼
SessionHost-owned PTY and pane
    │ generic terminal frames
    ▼
loopback terminal gateway
    │ ordered bidirectional WebSocket
    ▼
xterm.js browser surface
    ▼
human
```

| User action              | Observatory sends               | Owner             |
| ------------------------ | ------------------------------- | ----------------- |
| Key or paste             | `terminal.input`                | Agent application |
| Resize visible terminal  | `terminal.resize`               | Host PTY          |
| Wheel or PageUp/PageDown | `terminal.scroll`               | Host viewport     |
| Close a terminal tab     | `terminal.release`              | Host controller   |
| Receive output           | `terminal.frame` over WebSocket | Host → browser    |

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
5. upgrades the random session handle to an origin-checked WebSocket;
6. streams bounded, delivery-numbered replay and live frames over that socket; and
7. accepts only narrow input, byte-input, resize and scroll messages over the
   same ordered connection.

The handle is a local capability, not remote authentication. The server binds
to loopback, validates mutation Origin and intent, revalidates linked execution
handles before use, and releases all open sessions during shutdown.

The HTTP open action remains the capability exchange because terminal targets
must be resolved and validated before the browser receives a session handle.
After that, one WebSocket carries both directions of interactive traffic. This
avoids a request and JSON response for each xterm.js input event and preserves
input ordering. A dropped socket reconnects to the same process-local session
within a bounded grace period and requests only frames after its last delivery
identifier. If bounded replay can no longer fill that gap, the gateway fails
closed instead of presenting a corrupt terminal. HTTP release handles explicit
browser cleanup; the grace period handles browsers that disappear before that
request completes.

Server output observes WebSocket backpressure. Once Bun queues a frame, later
frames remain in a bounded application queue until `drain`; a dropped send or
queue overflow closes the transport so the delivery-numbered reconnect path can
recover it without silently omitting terminal bytes.

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

The deck header also switches between Agents without returning to Atlas.
Previous/next controls cycle through recently opened Agents followed by other
Agents with observed executions, and a searchable picker opens beneath its
left-aligned trigger and exposes the same set with Goal and lifecycle context. Agent switching changes the renderer-local
selection but preserves the Atlas camera. While a primary or companion surface
connects and settles its initial dimensions, an opaque loading mask prevents
intermediate xterm layout from flashing; the mask clears after the first
rendered frame or a bounded empty-terminal fallback. An observed execution is
only a candidate: the server still resolves the Agent and validates current
terminal access on every open.

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
