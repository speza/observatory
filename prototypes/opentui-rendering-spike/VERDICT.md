# Verdict — disposable OpenTUI rendering spike

> **THROWAWAY EXPERIMENT.** This directory is evidence for a rendering
> decision, not an AO implementation. It contains no persistence, control
> plane, Herdr integration, session discovery, or production abstractions.

Date: 2026-08-21  
Dependency exercised: `@opentui/core@0.4.5`  
Fixture: deterministic, 21 records: 12 primary map nodes (3 goals and 9
tracked sessions) plus 9 execution records (4 repositories and 5 worktrees)

## Exact run instructions

```sh
cd prototypes/opentui-rendering-spike
bun install
bun run start
```

The app is intentionally isolated here. `bun install` is the install command;
`bun run start` is the run command.

Controls:

- `1`, `2`, `3`: switch portable, orbital, and enhanced treatments.
- `j`/`k` or arrows: select; `h`/`l`/`u`/`d`: pan; `+`/`-`: zoom.
- Mouse drag pans the map; mouse wheel zooms around the pointer; mouse click
  selects a hit-tested node.
- `v`: toggle the optional repository/worktree topology lens. The default
  universe hides execution records and remains Goal → Session.
- `f`: in portable mode, toggle the selected-path focus lens and full topology.
- `/` or printable text: type-to-find; `Backspace` edits; `Enter` accepts;
  `Escape` clears.
- `i`: inspector; `t`: diagnostics; `s`: suspend/resume smoke test;
  `q` or `Ctrl-C`: clean exit.
- Mouse click selects a hit-tested node when the terminal sends mouse input.

## What was implemented

- One in-memory fixture with 21 records: 3 goals and 9 tracked sessions in the
  primary map, plus 4 repositories and 5 worktrees kept as execution records.
- A deterministic direct goal/session layout shared by all modes: goals are
  the largest durable objects, sessions occupy local arcs around their primary
  goal, delegated children sit on a secondary arc around their parent, and the
  default map has no repository/worktree hierarchy. `v` reveals the optional
  infrastructure lens without changing the primary topology.
- Typed goal/session containment, parent-child delegation, dependency, review,
  result-handoff, repository use, and worktree integration relationships, plus
  derived shared-worktree and write/write conflict-risk session edges.
- Session-carried execution metadata for repository IDs (including a goal that
  spans two repositories), branch, worktree, runtime, host/multiplexer,
  context size, and change mode. Shared worktrees appear as shared metadata and
  typed session edges; write/write overlap produces an unmistakable warning
  badge on the affected sessions and goal.
- Shared semantic state in every mode: goal scope, stable priority ring colour,
  lifecycle, attention, recency, quiet activity marker, selection, labels, and
  inspector path.
- Portable constellation: cell framebuffer, rounded Unicode/ANSI goal and
  session cards, stable goal colour families, explicit attention glyphs, a
  selected-path focus lens, and compact small-terminal layout.
- Orbital systems: animated layered framebuffer scene with goal orbits, trails,
  rounded goal/session cards, relationship lines, labels, and restrained
  activity markers.
- Enhanced experiment: native `drawGrayscaleBufferSupersampled` nebula probe,
  with the same semantic scene over it and a visible capability/fallback report.
- A follow-up Observatory card skin transferred from the visual-fidelity spike
  into all three modes: primary goals and sessions are stable rounded cards,
  goals carry a circular `◎` core, sessions inherit their primary goal's colour
  family, goals remain the largest durable objects, selection is a bright card
  outline, priority is a stable outline colour, active agents use one quiet
  marker, and attention uses a restrained pulsing outline plus a `!` status
  glyph and `!` label prefix. The old orbital, relationship, enhanced-buffer,
  and infrastructure-lens semantics remain available around that card grammar.
- 10 Hz deterministic fixture changes and a 30 FPS OpenTUI render loop.
- Live diagnostics for FPS, frame time, visible node count, tracked session
  count, execution-record count, update rate, terminal capability, and active
  mode.
- Keyboard navigation, type-to-find, pan, zoom, resize handling, selection,
  responsive inspector, framebuffer mouse hit testing, drag panning, and
  pointer-anchored wheel zoom.

## Observed performance and terminal behaviour

Evidence from the live pane run:

- The default intent map settled at `FPS 30`, `N12`, `S9`, and `U10/s` in the
  portable and orbital runs. Toggling `v` exposed the full `N21` record set
  without changing the update loop. Reported average frame time was
  approximately `0.4–0.6ms` in the observed pane. This is a small local
  observation, not a p95 benchmark.
- The enhanced mode also sustained the 30 FPS target while the supersampled
  native buffer was active. It produced more terminal output because the
  textured buffer changed many cells per frame, but it did not crash.
- The first full portable view was attractive but too equal-weight: the prior
  27-node layout, labels, attention halos, and relationship lines competed for
  attention. The portable mode now starts with a focused connected path around
  the selection; `f` keeps the original full-topology treatment available for
  comparison.
- The former hand-authored coordinates were removed from the fixture. The
  primary layout is derived from direct goal ownership and delegation; the
  optional repository lens additionally derives positions from repository use
  and worktree ownership, then projects everything with pan/zoom.
- The direct goal/session simplification removed a whole visual row and made
  the primary responsibility readable from the goal body to its session
  satellites. Removing repositories and worktrees from the default map made
  the result simpler again: execution metadata remains inspectable without
  competing with intent. Typed dependency, review, result-handoff, attention,
  shared-worktree, conflict-risk, and Git edges remain available as quieter
  secondary signals or through the optional lens.
- Sessions are the stored fixture identity. The inspector may describe an
  active session as a live agent view, while stopped sessions remain resumable
  tracked sessions.
- Before the current card pass, two intermediate visual passes had already
  reduced the original Braille/halo treatment. The card grammar now supersedes
  the literal circle experiment: it keeps the Observatory metaphor through
  layout, goal cores, and attention treatment while using geometry that behaves
  predictably on terminal cells. The old mode and relationship controls remain
  for comparison.
- The pane reported `ansi/unicode`; it did not advertise Kitty or Sixel
  graphics. No graphics escape sequence was emitted by the enhanced mode.
- A short default pane (80×13 in this environment) is handled without
  overflowing the inspector: labels become deliberately compact and the
  inspector waits for a taller or wider terminal. A resized 120×30 nested pane
  also started and exited cleanly.
- The keyboard interaction pass exercised mode changes, `/router` search,
  selection, pan, zoom, diagnostics, inspector toggle, portable focus lens, and the `s`
  suspend/resume smoke path. An SGR mouse click hit a fixture node. The process
  exited with code 0.
- A live SGR mouse pass exercised click selection, drag panning, and wheel zoom
  around the pointer. The status line reported `mouse pan complete` and
  `mouse wheel 110%`/`99%`; the follow-up `q` restored terminal state.
- A live infrastructure-lens pass reported `N12` in the default universe and
  `N21` after `v`; the optional view showed repository/worktree records while
  the default view retained only goals and sessions. Search can select an
  execution record and the inspector reports its attached sessions and
  session-carried runtime metadata.
- A fresh 120×30 run switched through modes 1 → 2 → 3 → 1 at approximately
  `FPS 30`, `N12`, and `U10/s`; a separate suspend/resume run reported
  `suspend/resume returned cleanly` before `q` exited with code 0.
- The follow-up card-skin pass was run in a 140×35 pane through modes 1 → 2 →
  3 → 1, the `v` infrastructure lens, `f` focus lens, and `t` diagnostics
  toggle. It held roughly `29–30 FPS` at `0.4–0.6ms` reported frame time,
  retained `N12`/`N21` as the lens changed, and exited with code 0.
- The follow-up Observatory card pass was run in a 120×30 pane. It held roughly
  `30 FPS` at `0.4–0.5ms`, retained `N12`/`S9`/`U9–10/s`, and exited with code 0. The three goal families were visibly distinct through card tint and
  labels, while selection and attention remained separate outline/glyph
  signals.
- The card pass is calmer and more stable than the literal circle experiment:
  a goal reads as a larger observation target and a session as a smaller,
  consistent attached card. The composition pass then moved the three goals
  into a stable triangular field, prefers centred labels above goal cards, and
  removes non-selected portable relations from the default view. Removing the
  attention arrows and dimming ambient activity markers reduced the remaining
  visual competition without hiding the blocked `!` state or the selected path.
  Labels can still collide at extreme zoom or very short widths; this remains
  primarily a placement and density problem, not a missing OpenTUI primitive.
- The fresh composition pass was run in 120×30 and 80×24 panes. Both sizes
  switched through modes 1 → 2 → 3 → 1, toggled the infrastructure and focus
  lenses, toggled diagnostics, and exited with code 0. The wide run reported
  roughly `30 FPS`, `0.4–0.5ms`, `N12`, `S9`, and `U9–10/s`; the compact run
  stayed within the responsive layout without overflowing the terminal.
- The responsive breakpoint was tightened after a live 80×24 run exposed
  bottom-inspector collisions. At fewer than 26 rows the map keeps the full
  vertical area and the bottom inspector is deferred; at wider/taller sizes the
  existing inspector returns. The terminal remained clean after the follow-up
  `q` exit.
- `q` and Ctrl-C restored the alternate screen, cursor, mouse reporting,
  bracketed paste, Kitty keyboard state, and related terminal modes. No
  corrupted terminal state remained after either exit path.
- `bun run typecheck` passes.

The POC intentionally does not add nested goals, workstreams, or derived
clusters. Those are deferred experiments only if real usage demonstrates that
direct goal/session ownership cannot carry the required density.

The production design document asks for a larger 50-visible/100-loaded-node
test, p95 input latency, long-run memory/flicker checks, direct Ghostty and
Herdr/tmux attach/resume. This request deliberately used a 20–30-node fixture,
so those acceptance criteria remain untested.

## What OpenTUI made easy

- The imperative `FrameBufferRenderable` is a useful low-level surface for a
  custom spatial renderer. `setCell`, `drawText`, `fillRect`, and native buffer
  effects were enough to build all three treatments without Chromium.
- `createCliRenderer({ targetFps: 30 })` and `start()` gave a straightforward
  continuous animation loop.
- Native capability detection, structured key events, resize events, mouse
  events, `suspend()`, `resume()`, and `destroy()` cover the lifecycle needed
  for a real terminal client.
- The same semantic fixture could drive radically different presentations
  without putting renderer concepts into the fixture.

## What was difficult

- The framebuffer is a terminal-cell surface, not a normal 2D canvas. AO must
  own clipping, logical-to-cell projection, overlap policy, label placement,
  hit targets, and Unicode-width discipline.
- Twenty-one nodes are already visually dense in a short terminal. Animation
  adds delight and hierarchy but can turn into noise when labels and edges share
  a small cell grid.
- `@opentui/core@0.4.5` exposes Kitty/Sixel capability detection but no public
  image renderable or `@opentui/three` path through this core-only install.
  `@opentui/three` was not installed because it is a separate native/WebGPU
  experiment, not a safe dependency for the portable POC.
- OpenTUI exposes renderer statistics, but input-to-frame latency and a useful
  long-run memory/flicker report need instrumentation outside this small POC.

## Decision

### Can native OpenTUI render a compelling AO universe?

**Yes, plausibly for the first goal-centred map at ordinary terminal sizes.**
The portable mode retains the important actions and semantics, and the orbital
mode is the strongest visual treatment: goals read as large anchors, sessions
orbit their primary goal, attention has a shape-and-pulse signal, and
delegation and execution warnings can coexist in one framebuffer without
turning repositories or worktrees into a second hierarchy. Goals can span
repositories while the map stays centred on intent and attention.

The answer is **not yet proven for high-fidelity terminal graphics**. In this
install, mode 3 is an honest native supersampled-cell experiment, not Kitty,
Sixel, an image protocol, or Three.js. It improves texture but does not prove
that those protocols can coexist with readable AO chrome.

### Recommendation

**Investigate further, with portable cells as the required baseline and orbital
rendering as the leading candidate.** Accept the direct Goal → Session product
model for this rendering direction; do not promote the POC or accept OpenTUI as
AO's production terminal renderer yet. The optional infrastructure lens is a
useful escape hatch, but the evidence still does not justify making it part of
the default universe.

### Next smallest experiment

Keep this 21-record fixture and run one capability matrix in a fresh disposable
spike:

1. core-only portable/orbital mode;
2. the smallest separately installable `@opentui/three` or image-protocol path;
3. Kitty/Sixel-capable terminal and a plain ANSI terminal; and
4. a 10 Hz update stream with recorded p95 input-to-frame latency.

If the graphics path still requires bespoke protocol output or harms label
legibility, stop expanding it and treat OpenTUI as a portable cell renderer;
compare the same fixture against Ratatui before making the production choice.
