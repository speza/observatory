# Native terminal surface POCs

Status: historical evidence; native client retired 2026-08-27
Date: 2026-08-22
Depends on: [V0 live Herdr universe/map](v0-live-herdr-command-centre.md)

Design context: [technical architecture](../design/technical-architecture.md),
[technology decisions](../design/technology-decisions.md)

> These completed experiments proved that the `SessionHost` terminal seam was
> viable. Their OpenTUI implementation was removed with the native client. The
> production browser terminal now consumes the surviving generic capability
> through xterm.js and the loopback gateway.

## Question

Can Observatory keep its map-first TUI while giving a terminal purist access to
the real native CLI, without building a universal fake chat client or committing
to an Observatory-owned multiplexer too early?

The current V0 answer is a host-owned Herdr terminal surface inside
Observatory. `t`, `Enter` and an agent double-click open the same embedded
terminal and return to the preserved map. Foreground attachment remains a
capability seam for future hosts, but is not the primary interaction. The
embedded route proves the narrow first interaction surface; it does not claim
to reproduce every provider-specific terminal feature.

These experiments separate that rendering question from the much larger question
of who owns persistent agent processes.

## Principles

- The provider's native CLI remains authoritative. Observatory must not pretend
  to reproduce every provider-specific prompt, slash command or terminal UI.
- A terminal surface transports a real terminal, rather than translating output
  into a generic chat transcript.
- The host owns the process and PTY whenever a durable host exists. Observatory
  renders and routes input through an explicit capability.
- Unsupported capabilities remain visible and honest. An agent may support
  observation, native terminal access, structured messaging or none of these.
- Prototype code is disposable, in-memory and isolated from the Universe,
  SQLite schema and production host interfaces.

## Staged experiments

### POC A — Observatory-owned PTY fidelity

#### Purpose

Prove that Bun and OpenTUI can host a real interactive terminal inside a map
client. This is a renderer and input experiment, not a decision to make AO a
multiplexer.

#### Shape

```text
real shell or agent CLI
          ↕ Bun.Terminal (PTY / ConPTY)
AO-owned prototype process
          ↕ ANSI/VT terminal emulator model
OpenTUI terminal panel + map shell
```

The prototype launches one child process in memory and keeps it alive only
while the prototype is running. Bun's terminal transport supplies output,
input, resize and TTY semantics. A terminal emulator model converts ANSI/VT
output into cells, cursor state and screen contents for an OpenTUI panel.
See [Bun terminal support](https://bun.sh/docs/runtime/child-process) for the
runtime contract being tested.

Start with a shell that emits colours and cursor movement. Then try one real
installed agent CLI. The prototype should have a fixed terminal panel, a map
placeholder, and a clear key to return to the map.

#### Must prove

- the child reports a TTY and retains its native full-screen behaviour;
- ANSI colour, cursor movement, alternate-screen behaviour and Unicode render
  acceptably in an OpenTUI panel;
- printable input, control keys and interrupt reach the child correctly;
- panel resize sends the new terminal dimensions;
- streaming output does not starve or corrupt the map renderer; and
- leaving the panel restores the map without leaving the outer terminal in a
  broken mode.

#### Explicitly not proved

- process survival after Observatory exits;
- reconnecting from a second client;
- agent discovery or Herdr integration;
- full scrollback, copy/paste, mouse protocols or multiple terminal panes;
- semantic transcript parsing; or
- a production terminal-emulator dependency.

#### Verdict

Pass means native terminal rendering is technically plausible in the TUI.
Failure means the TUI should keep native interaction as a host attachment and
use read-only previews rather than emulate a terminal in the map client.

### POC B — Herdr-backed terminal surface

#### Purpose

Prove that Herdr can provide the durable process lifecycle while Observatory
renders and controls a selected real agent in a terminal panel.

#### Shape

```text
Herdr server-owned agent terminal
          ↕ terminal agent control stream
Observatory Herdr adapter
          ↕ terminal frames, input, resize, release
OpenTUI terminal panel + map
```

Use Herdr's read-only observe path first, then its writable control path. The
adapter must keep Herdr targets opaque and expose terminal access as a
capability, not as pane-shaped domain objects.
The concrete stream and command contract is documented in Herdr's [CLI
reference](https://github.com/herdrdev/herdr/blob/master/docs/next/website/src/content/docs/cli-reference.mdx).

The control lifecycle is:

```text
select agent
  -> request terminal capability
  -> open a controller with the current panel dimensions
  -> render frames and forward input
  -> release controller on Esc, close or host failure
  -> return to the same map selection and viewport
```

#### Must prove

- an existing Herdr agent can be rendered without opening the full Herdr UI;
- the real CLI remains native, including streaming output and prompts;
- input, interrupt and resize reach the server-owned terminal;
- only the selected agent receives input;
- releasing Observatory does not stop the Herdr agent;
- reconnecting after a panel close restores a usable agent; and
- host loss or controller ownership conflicts are reported without corrupting
  the map or claiming success.

#### Explicitly not proved

- support for arbitrary non-Herdr agents;
- a new AO daemon;
- a generic provider messaging API;
- durable transcript ingestion; or
- full parity with Herdr's own selection and scrollback UX.

#### Verdict

Pass means Herdr can remain the V0 agent runtime while Observatory adds a
native terminal lens. That pass is now implemented behind `SessionHost` and
exercised through the mock adapter and a live map → terminal → release → map
smoke. Foreground attach remains an adapter capability for unsupported agents and the
reference path for provider-native features not covered by the embedded lens.

## Evidence log — 2026-08-22

Both staged experiments have now been exercised without changing the
production control-plane boundary.

### POC A result

The Bun/OpenTUI prototype launched a real shell in a Bun PTY and rendered
colours, cursor movement, alternate-screen transitions, streaming output and
basic Unicode in a cell-based terminal panel. A deterministic child process
read a printable `x` through the panel and echoed `GOT:x`, proving input
forwarding; control-key forwarding and resize wiring are implemented, with the
initial PTY dimensions passed from the panel. The interactive smoke check
verified clean Ctrl-Q return, while a deterministic ANSI-producing shell
command verified coloured output without leaking terminal state on exit.

The same run rendered the installed Codex CLI's `--help` output, so the panel
has crossed the shell-versus-agent boundary without requiring a provider
integration. This is a technical pass for “a native terminal surface is
plausible in the TUI”, not a claim of terminal-emulator completeness. The
deliberately small VT model has not proved wide-character measurement, full
scrollback, mouse protocols, a full interactive agent task, or long-running
process ownership.

### POC B result

The same panel model connected to Herdr's observe and control streams. A live
Herdr agent rendered its real ANSI frame inside the panel, including its native
prompt and status output. The control agent was opened with takeover,
released with `terminal.release`, and the Herdr agent remained alive and idle
after Observatory returned to the map. The read-only observe path also
rendered the same live agent without taking control.

The adapter wiring covers input, resize, release, frame decoding, host errors
and controller conflicts. A single arrow key was sent through the live control
surface; `herdr agent get` afterwards showed the same idle agent and revision,
with no task mutation. After release, a second read-only observe connection
rendered a fresh frame from the same agent. An invalid target produced a
`terminal.closed` reason that the panel surfaced in red rather than treating
the controller exit as success.

We deliberately did not send Ctrl-C to the live agent or simulate a Herdr
server outage during this smoke test. Interrupt and actual host-loss recovery
remain product-dogfood checks rather than claims made by this POC.

This is a technical pass for “Herdr can remain the process owner while
Observatory supplies a native terminal lens”. It does not prove full Herdr
scrollback/selection parity, generic provider messaging, transcript ingestion,
or support for hosts other than Herdr.

### Production lens slice

The transport was promoted behind the production `SessionHost` seam without
promoting Herdr protocol details into the Universe. Herdr and the deterministic
mock host now expose the same optional host-owned terminal capability. The TUI
opens it with `t`, renders frames through the small cell-native `TerminalScreen`
model, routes text/control sequences and resize, and releases with Ctrl-Q or
Esc. The selected agent, lens and inspector remain intact when the map
returns. The mock path proves input echo, resize and release deterministically;
the live path refreshed a real Herdr snapshot, opened a real selected agent,
rendered its stream, released it, and returned to the list lens without
mutating the agent task.

### Product verdict so far

The first production slice is a Herdr-backed terminal lens entered from a
selected Goal → Agent node and exited back to the preserved universe. It
keeps the provider CLI authoritative, gives terminal-focused users a useful
interaction path, and avoids making Observatory responsible for durable PTYs.
POC A remains valuable as evidence and a disposable renderer experiment, but
its AO-owned process lifetime is not a V0 product commitment.

Before calling the lens complete for every host and provider, dogfood the full
loop on real work: map → observe/control → harmless input or interrupt → resize
→ release → map, including a host disconnect and a second attach. Until that
passes, foreground attach remains the honest fallback.

The evidence does not justify Decision C. An AO-owned daemon or multiplexer
stays deferred unless Herdr (and a later host adapter) cannot provide the
required lifecycle and control experience.

### Decision C — AO-owned durable runtime

This is a later product decision, not a prerequisite for either POC.

If POC A proves that AO should own the terminal rendering and POC B cannot give
the required lifecycle or control, evaluate a small AO runtime daemon:

```text
ao server
  ├── owns PTYs and child processes
  ├── persists agent descriptors and reconnect metadata
  └── serves TUI, web and agent clients over a local socket
```

That would be the beginning of an AO-native multiplexer. It needs explicit
decisions about process supervision, crash recovery, authentication, cleanup,
remote access, terminal scrollback and provider launch contracts. Do not build
it merely to make POC A work.

## Comparison

| Question              | POC A: AO PTY           | POC B: Herdr surface              | Decision C: AO runtime           |
| --------------------- | ----------------------- | --------------------------------- | -------------------------------- |
| Who owns the process? | AO prototype            | Herdr server                      | AO daemon                        |
| Native CLI fidelity   | Test directly           | Test through Herdr stream         | Test directly                    |
| Survives AO exit?     | No                      | Yes, through Herdr                | Yes, through daemon              |
| Existing agents?      | No                      | Yes, Herdr agents                 | Only AO-managed unless imported  |
| New infrastructure    | PTY + terminal emulator | Herdr adapter + terminal emulator | PTY, daemon and lifecycle system |
| Product status        | Disposable evidence     | Implemented V0 capability         | Deferred option                  |

## Recommended order

1. Run POC A with a shell, then one real agent CLI. This isolates terminal
   emulation and OpenTUI input from host protocol questions.
2. Reuse the same terminal-panel model for POC B and connect it to a real
   Herdr agent through the observe/control stream.
3. Keep the production `t` lens deliberately narrow and dogfood it against the
   map: map → terminal → map, with selection and attention state preserved.
4. Compare it with the direct `Enter` terminal path on real work before adding
   provider-specific messaging, transcript features or another host adapter.
5. Only revisit an AO-owned runtime if Herdr cannot provide the required
   lifecycle and control experience.

## Success criteria for the product decision

The embedded surface is worth keeping only if a user can return to a selected
agent, understand its current native CLI state, intervene without losing
context, and return to the universe faster than opening the host separately.
Technical fidelity alone is insufficient; the map must remain useful while the
terminal surface is open.
