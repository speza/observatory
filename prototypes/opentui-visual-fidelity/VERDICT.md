# Verdict — native terminal visual fidelity

Date: 2026-08-21

## Exact run instructions

```sh
cd prototypes/opentui-visual-fidelity
bun install
bun run start
```

Validation command:

```sh
bun run typecheck
```

This is disposable code. It has no persistence, AO control plane, Herdr
integration, session discovery, or production abstractions. The earlier
`prototypes/opentui-rendering-spike/` was left frozen and was not edited.

## What was implemented

- One deterministic goal: **Ship a verified model router**.
- Seven directly attached tracked sessions: `router-impl`, `routing-review`,
  `quality-evals`, `fallback-audit`, `rollback-proof`, `release-rehearsal`,
  and `human-checkpoint`.
- Goal → Session is the only visible topology.
- Repositories, branches, worktrees, runtimes, hosts, and context sizes exist
  only as session inspector metadata. They are never map nodes or map edges.
- A deliberately composed scene with one large half-block goal orb centred in
  the usable map and seven compact session orbs arranged around it.
- One selected session by default; only its direct goal path is drawn.
- One blocked session with one pulsing halo, `!` in the orb and caption, and
  explicit `BLOCKED` inspector state.
- Neutral portable agent iconography: `♙` marks a session/agent without
  pretending to be a Claude, Codex, or Pi logo. The goal uses `◎`; selection
  uses a bright halo and `▸` caption.
- Half-block upper/lower colour planes create rounded bodies and shallow depth
  using only the portable cell framebuffer. No ambient stars, orbit rings,
  repeated warning arrows, provider logos, or image-protocol dependencies.
- Keyboard selection, Enter focus, `+`/`-` zoom, `h`/`l`/`u`/`d` pan, `i`
  inspector, `t` diagnostics, `r` reset, resize handling, and clean `q`/Ctrl-C
  exit.
- Live diagnostics for FPS, frame time, node count, update rate, cell/graphics
  capability, and the disposable scene mode.
- Portable Unicode/OpenTUI only. No enhanced graphics comparison was added;
  it would obscure this experiment's product question.

## Acceptance review

| Criterion | Result | Evidence |
| --- | --- | --- |
| Identify goal, seven sessions, selected and blocked state in three seconds | Pass at 140×35; pass with shortened captions at 80×24 | The wide scene has a strong central orb and deliberate satellite ring; compact mode preserves the central scale hierarchy and shortens only captions. |
| Goal → Session is the only default topology | Pass | The fixture has one goal ID on every session; the renderer draws only the selected direct path. |
| Selected path dominates without hiding other sessions | Pass | The selected orb, `▸ router-impl` caption, matching inspector title, and one solid direct tether are distinct; no other relationship bundle is drawn. |
| Blocked attention is clear without colour alone | Pass | `! quality-evals`, pulsing halo, `!` orb glyph, and inspector `BLOCKED` copy. |
| Intent first, infrastructure subordinate | Pass | Session descriptions and status are in the scene; repo/branch/worktree/runtime/host/context are in the inspector only. |
| Keyboard focus, selection, inspection, zoom, reset, and suspend cleanup | Pass | Exercised live with `j`, `k`, Enter, `i`, `+`, `-`, pan keys, `r`, `t`, and `s`. |
| Stable portable cell rendering near 30 FPS | Pass | Warmed-up readings were 30–31 FPS and approximately 0.3 ms application frame time. |
| Terminal-heavy user would prefer it to a flat sidebar | No, not established | The scene is now materially more art-directed, but the map still has to earn the extra spatial navigation cost. No A/B task comparison was run, so preference cannot be claimed. |

## Observed behaviour

At 140×35 the final composition is materially more intentional than the frozen
rendering POC and the previous sparse card scene. The goal fills roughly a
quarter of the usable scene height as a shaded orb, the seven sessions form a
deliberate constellation around it, and the selected session is the same
`router-impl` object named in the inspector. The one solid selected tether is
visible without a graph bundle. The blocked session is immediately findable
through the single pulsing halo, `!` orb mark, `!` caption, and inspector state.
The neutral `♙` agent mark adds identity without introducing provider-logo
noise.

At 80×24 the scene still renders and all seven labels are present, but the
available cell budget forces the goal and session orbs closer together. Captions
shorten to avoid colliding with bodies, while the focused goal remains the
largest object. The inspector can be toggled into a compact bottom panel,
which is functional but not a comfortable default for sustained use.

Selection, focus, zoom, pan, diagnostics, reset, resize, and exit were tested
in the live pane. Exiting with `q` restored the alternate screen, cursor, mouse
state, and bracketed input state. No crash or persistent terminal corruption
was observed.

See [evidence/LIVE-OBSERVATION.md](./evidence/LIVE-OBSERVATION.md) for the
recorded live sizes, input sequence, normalized frame, and diagnostics.

## What OpenTUI made easy

- An imperative TypeScript framebuffer was enough for a complete native scene.
- Unicode borders, colour, text, resize, keyboard input, and a 30 FPS render
  loop were straightforward.
- The cell framebuffer can also support a convincing small neutral icon and
  half-block depth treatment without external image protocols.
- A slow blocked-state pulse and live renderer statistics were inexpensive.
- The application can keep infrastructure metadata in the inspector without
  accidentally making it part of the map.

## What was difficult

- Terminal cells have a coarse, non-square visual grid. Small spacing changes
  alter whether labels feel intentional or collide.
- Text clipping and layout are the hard part, not drawing the orb bodies. The
  compact inspector consumes enough vertical space to reduce the scene's
  breathing room, and short terminals require caption shortening.
- The scene is hand-authored. It demonstrates an art direction, not a layout
  algorithm that can safely place arbitrary real-world sessions.
- Portable cells cannot provide the typographic hierarchy, anti-aliasing, or
  hit-area forgiveness of a graphical canvas. An enhanced Kitty/Sixel path
  would not remove the need for a strong portable fallback.
- Provider logos and richer raster imagery are possible only as a terminal-
  capability-specific comparison. They are not a safe default visual language
  for an ordinary ANSI/Unicode terminal.

## Product judgment

**Blunt answer: no, we still cannot say a terminal-heavy user would genuinely
prefer this over the current flat Herdr/Codex/Claude sidebar.** This final pass
does establish a stronger result: a native portable scene can look like a
focused living system rather than a sparse architecture diagram when it is
limited to one goal, direct sessions, one selected path, neutral agent marks,
and almost no decoration. It is now credible for a one-goal attention view,
but the spatial map still adds navigation and label-reading cost without an
A/B task result proving that the orbit repays it.

OpenTUI should be **investigated further**, not rejected for rendering
capability and not accepted for product value yet. The blocker is primarily
product/design execution and the portable terminal-cell constraint—not an
OpenTUI crash or missing imperative rendering capability. True provider logos
or raster imagery remain terminal-dependent and are not necessary to judge
this portable product question.

## Next smallest experiment

Build one static A/B frame at the same 80×24 and 140×35 sizes: this exact scene
beside a grouped flat session list containing the same goal, statuses,
descriptions, and metadata. Give a few terminal-heavy users five tasks:

1. find what needs human attention;
2. identify which session is doing rollback work;
3. inspect the execution context for the selected session;
4. explain which sessions belong to the goal; and
5. return to the selected work.

Measure time, errors, and preference. If the map does not win the attention
and context tasks, stop investing in native spatial rendering. If it does,
then test a second goal and real session churn before considering any nested
goal, workstream, or derived cluster. Those structures should only be added
if actual usage demonstrates that direct Goal → Session has become insufficient.
