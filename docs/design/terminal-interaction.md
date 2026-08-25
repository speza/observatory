# Observatory embedded terminal interaction

Status: accepted V0/V1 implementation decision  
Date: 2026-08-23  
Related: [Observatory technical architecture](technical-architecture.md),
[V0 live Herdr universe/command centre](../specs/v0-live-herdr-command-centre.md),
[native terminal surface POCs](../specs/terminal-surface-pocs.md)

## Decision summary

Observatory renders hosted agent terminals inside the native TUI, but it does
not own the PTY, process, pane scrollback or agent terminal state. Those remain
owned by the configured `SessionHost`; Herdr is the required live V0/V1 host.

The same host-owned terminal contract can power one transient linked execution
surface for the selected Agent. A linked execution may be an existing shell
observed in the host, a host-prepared shell in the Agent worktree, or a
recognised sibling Agent. It is contextual
UI, not a second AO agent or a new durable topology node. Diff and review
tools are deliberately not native Observatory surfaces in the first
implementation. The user can run `git diff`, `hunk`, `delta` or another review
tool inside the linked terminal.

Observatory uses two different host capabilities for interaction:

- `terminal.input` sends text or bytes to the agent application. This is used
  for normal keys, paste and other agent-directed input.
- `terminal.scroll` changes the host-owned terminal viewport. This is used for
  trackpad wheel gestures and PageUp/PageDown in the embedded terminal.

The renderer still maintains a bounded terminal-cell model so it can display
ANSI frames, but local history is not the authoritative scrollback source.

For Herdr, Observatory deliberately translates both pointer scrolling and
PageUp/PageDown into the host's `page_key` scroll source. Herdr's `wheel` source
can be routed to an application that has enabled mouse reporting; that is the
right behaviour for a normal direct attach client, but not the desired default
for Observatory's “browse the agent history” gesture.

## The terminal model

An agent does not write pixels. It writes bytes to a pseudo-terminal (PTY):

```text
agent process
    │ output bytes and ANSI control sequences
    ▼
host-owned PTY and pane (Herdr in V0/V1)
    │ terminal frames
    ▼
Observatory terminal-cell model
    │ OpenTUI cells
    ▼
human's terminal window
```

ANSI control sequences can print text, move the cursor, change colour, clear a
region, switch between normal and alternate screen buffers, and enable mouse
reporting. Observatory's `TerminalScreen` applies those sequences to a grid of
cells. A `terminal.frame` is not a screenshot; it is a byte stream containing a
full or incremental set of terminal instructions.

The important distinction is that several different things may be called
“scrolling”:

1. An agent application may scroll its own interface.
2. The host may scroll the pane's retained terminal history.
3. Observatory may move through history captured by its local emulator.

Those operations are not interchangeable. Full-screen agent interfaces often
use an alternate screen buffer and repaint the visible grid rather than
emitting ordinary transcript lines. Observatory cannot reconstruct host history
that was never sent in the stream.

## Interaction ownership

| User action                          | Observatory sends                 | Owner of the operation      |
| ------------------------------------ | --------------------------------- | --------------------------- |
| Printable key, navigation key, paste | `terminal.input`                  | Agent application           |
| Resize Observatory                   | `terminal.resize`                 | Host PTY/terminal agent     |
| Trackpad wheel                       | `terminal.scroll` with `page_key` | Host viewport               |
| PageUp/PageDown                      | `terminal.scroll` with `page_key` | Host viewport               |
| Release embedded terminal            | `terminal.release`                | Host controller             |
| Output or viewport update            | `terminal.frame` received         | Host → Observatory renderer |

The scroll decision is intentional: a pointer wheel is treated as a request to
browse the hosted agent, not as an instruction that the agent must interpret.

## The failed implementation

The first implementation mixed local and application-owned scrolling:

1. Mouse events sometimes changed `TerminalScreen`'s local scroll offset.
2. If local history was unavailable, Observatory injected PageUp or mouse
   escape sequences as ordinary `terminal.input` bytes.
3. The agent then decided whether those bytes meant anything.

This failed in several ways:

- `terminal.input` targets the agent, not Herdr's pane viewport.
- An agent with mouse reporting enabled can consume wheel input itself.
- A full-screen agent can have no useful local scrollback in Observatory.
- An agent may ignore PageUp, use a different key binding, or repaint without
  producing the output Observatory expected.
- Local history can look plausible while diverging from the host's actual
  scroll position.

The result was that the input event was visibly received but nothing moved.

## Linked execution surface interaction

Observatory has two presentation modes:

- map mode keeps the spatial map visible beside a linked terminal; and
- review mode keeps the primary agent terminal visible beside a linked terminal.

The host may report N linked executions, but only one selected linked execution
surface is open at a time in the first implementation. A picker makes every
available link visible before opening the selected one. The focused surface owns
ordinary key input, paste and scroll. `Tab` cycles focus;
the focus ring and footer identify where input will go. An unfocused terminal
continues receiving frames and remains visible for comparison. `Esc` closes the
focused terminal, and terminal release is delegated to the host.

The selected-agent action menu exposes the linked terminal, so the user does
not need to return to Herdr to control or inspect a discovered linked terminal.
Right-clicking another map target opens that menu as a transient context
target and leaves the primary selection alone; choosing an operation promotes
the target when the operation needs primary context.
A shell-only Herdr pane is still never treated as an AO Agent until Herdr reports
it in its authoritative agent inventory. A map portal is deferred until its
placement and hit testing are mature.

Host reconciliation continues while either terminal surface is open so a shell
that becomes a Claude, Codex or Pi process can appear as a normal Agent without
closing the review context. `Ctrl-Shift-R` requests an immediate snapshot;
ordinary `R` remains terminal input. An open linked picker is revalidated and
updated from the latest capability after reconciliation, and closes if its
owner or all of its linked executions disappear.

## Alternatives considered

### Local Observatory scrollback

Capture every output byte and implement all scrolling locally.

Pros:

- independent of host-specific scroll APIs;
- potentially low-latency once the data is local;
- full control over selection and copy behaviour.

Cons:

- cannot recover history the host did not stream;
- difficult to make correct for alternate-screen applications;
- requires a substantially more complete terminal emulator;
- consumes memory for long-running agents;
- can disagree with the host's viewport and scroll limits.

This remains useful as a bounded rendering aid and possible future fallback, but
not as the primary source of truth.

### Raw PageUp or mouse input

Translate a scroll gesture into bytes and send those bytes to the agent.

Pros:

- matches what a conventional terminal sends;
- lets an application own its own semantic scrolling;
- requires no host-specific scroll command.

Cons:

- behaviour is application-dependent;
- mouse reporting changes the meaning of wheel events;
- it cannot guarantee host scrollback access;
- there is no reliable acknowledgement that the viewport moved.

This is still correct for ordinary agent-directed input, but it is the wrong
default for Observatory's host-history browsing gesture.

### Explicit host scroll

Ask the host to move the attached viewport and render the returned frame.

Pros:

- uses the authoritative host scrollback;
- works independently of the agent's key bindings;
- handles full-screen and mouse-reporting applications more consistently;
- avoids unbounded local history;
- keeps host process and PTY ownership in the host adapter.

Cons:

- requires the host to expose an equivalent capability;
- host scrolling may differ from an agent's own application-level history;
- the terminal renderer still needs to apply incremental ANSI frames;
- controller ownership and takeover rules remain host-specific.

This is the accepted V0/V1 approach. Herdr exposes `terminal.scroll` in its
terminal control stream and documents that control mode accepts scroll commands
alongside input, resize and release commands:

- [Herdr CLI reference](https://herdr.dev/docs/cli-reference/)
- [Herdr persistence and remote access](https://herdr.dev/docs/persistence-remote/)

## Implementation boundaries

The generic host contract deliberately does not contain Herdr protocol names.
Conceptually, it exposes:

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

The Herdr adapter maps `source: "page-key"` to the wire-level
`source: "page_key"` and writes a newline-delimited JSON command. Herdr's
identifiers, command names and takeover mechanics remain inside
`src/hosts/herdr/`.

Responsibilities are split as follows:

- `renderer/tui.ts` decides what a user gesture means and submits a generic
  host capability.
- `hosts/types.ts` defines the host-neutral terminal interaction shape.
- `hosts/herdr/terminal.ts` translates the shape into Herdr's control stream
  and parses Herdr frames.
- `renderer/terminal-screen.ts` interprets ANSI bytes into cells and styles.
- `SessionHost` owns process lifetime, PTY ownership, resize and release.

The local web renderer uses the same ownership boundary. Its loopback gateway
opens a generic `SessionHost` terminal, streams frames as server-sent events and
maps browser input, resize and close to the existing session capabilities.
xterm.js interprets terminal bytes in the browser; it does not own the PTY or
persist scrollback. The terminal floats above the Atlas, so opening or closing
it does not mutate selection, viewport or inspector state.

A future tmux, Superlogical-style host, or Observatory-owned multiplexer must
implement the same capability without changing the Universe, persistence,
projection or renderer interfaces. If that is not possible, the host seam is
leaking and must be repaired before adding the host.

## Known limits and follow-ups

- Herdr is a deliberate live-host dependency for V0/V1, although it is not a
  dependency of the semantic control plane.
- A host scroll command does not expose the agent's internal semantic history;
  it exposes the host viewport.
- Scroll position is transient terminal state, not durable Observatory state.
- Copy and selection across host scrollback need a deliberate design; local
  captured history alone is not sufficient for arbitrary full-screen agents.
- Terminal fidelity is incremental. Unsupported ANSI features must degrade
  visibly and safely rather than silently changing semantic Observatory state.
- Hosts without host-owned scroll should report that capability as unsupported;
  the renderer must not guess by injecting provider-specific escape sequences.
- A discovered linked shell can disappear or change ownership between snapshots;
  opening it must revalidate its opaque terminal identity, return an honest host
  error and must not manufacture a durable AO agent.
- Observatory does not provide a native diff viewer yet. Diff and review tools
  run in a linked shell until a concrete native workflow justifies a separate
  surface.

## Verification expectations

Terminal interaction changes should include:

1. generic host contract coverage for text, bytes, scroll, resize and release;
2. adapter tests for the exact provider wire mapping;
3. deterministic mock-host coverage for frame updates;
4. stale/reused target coverage proving no terminal-control command is spawned;
5. a live, non-destructive host smoke proving that a scroll command produces a
   changed viewport frame; and
6. `bun run format`, `bun run check`, `bun test` and `bun run dev:mock` renderer
   dogfooding where the change affects the TUI.
