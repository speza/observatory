# OpenTUI visual-fidelity spike — disposable

Status: historical evidence only. The OpenTUI product direction was retired;
the executable, package manifest, lockfile and TypeScript configuration have
been deleted. The descriptions and controls below document the experiment,
not a supported application. See [VERDICT.md](./VERDICT.md) for its findings
and [technology decisions](../../docs/design/technology-decisions.md) for the
current web-only direction.

This is a deliberately narrow, throwaway visual experiment. It is not a
product surface and must not grow into one. The older
`prototypes/opentui-rendering-spike/` is frozen; this directory explores a
different question instead of adding more polish to that grammar.

## Question

Would a calm, native terminal universe make a terminal-heavy operator prefer
navigating one goal and its active sessions over a flat Herdr/Codex/Claude
session sidebar?

The experiment is intentionally one art-directed portable scene:

- one goal: **Ship a verified model router**;
- seven directly attached tracked sessions;
- one focused goal, one selected session, and one blocked session;
- Goal -> Session is the only map topology;
- repository, branch, worktree, runtime, host/multiplexer, and context size are
  session metadata only;
- only the selected goal-to-session path is drawn by default;
- no persistence, AO control plane, Herdr integration, session discovery,
  production abstraction, or alternate topology mode.

## Acceptance criteria defined before implementation

The finished scene should satisfy these tests at a glance and during keyboard
use:

1. Within three seconds, a viewer can identify the goal, the seven sessions,
   the selected session, and the blocked session.
2. The goal is the clearest durable object and every session reads as directly
   attached to it; no infrastructure node competes for topology attention.
3. The selected session and its single relationship path are dominant without
   making the remaining sessions illegible.
4. Blocked attention is unmistakable without relying on red alone.
5. Session intent and status are comprehensible before opening the inspector;
   execution metadata is available without displacing intent.
6. `j`/`k`, Enter, `i`, `+`/`-`, and `r` support selection, focus, inspection,
   zoom, and reset without losing the scene.
7. The portable cell scene remains stable and legible at a normal terminal
   size while holding approximately 30 FPS.
8. The result is plausibly preferable to a flat sidebar for catch-up and
   attention triage, not merely more visually novel.

## Historical controls

Controls: `j`/`k` or arrows select a session, Enter focuses its path, `i`
toggles the inspector, `+`/`-` zoom, `h`/`l`/`u`/`d` pan, `r` resets the
viewport, `t` toggles diagnostics, `s` exercises suspend/resume cleanup, and
`q` or Ctrl-C exits.

The final art direction is a single focused observation system rather than a
general architecture diagram. The goal is a large half-block orb with a
shaded upper/lower body and `◎` core; seven compact session orbs occupy a
deliberate orbit around it. The selected session uses a bright halo, `▸`
caption, and neutral `♙` agent mark. The blocked session uses one pulsing halo,
`!` in the orb, and `!` in the caption. Labels use a one-cell tether to their
own object; no ambient stars, orbit rings, repeated warning arrows, or
provider-logo badges are drawn. Provider-specific imagery remains a separate
graphics experiment because portable terminals cannot guarantee it.

## Scope boundary

This spike intentionally does not test enhanced Kitty/Sixel/image/shader
rendering. The earlier rendering POC already established that those paths are
optional and terminal-dependent; this experiment isolates whether a restrained
portable cell composition can carry the product value.

Nested goals, workstreams, or derived clusters may be explored later only if
real usage demonstrates that a direct Goal -> Session scene cannot remain
legible. They are not stored or implied here.

See [VERDICT.md](./VERDICT.md) for live evidence and the unvarnished judgment.
