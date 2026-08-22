# Live observation record

Date: 2026-08-21

This record is based on direct inspection of the running OpenTUI framebuffer,
not a static mock or a code-only review. The tool environment does not expose a
terminal PNG capture API, so no image is fabricated here. The pane was run at
both sizes below and the normalized frame records what was visible.

## Commands and sizes

```sh
cd prototypes/opentui-visual-fidelity
bun install
bun run typecheck
bun run start
```

- Compact run: 80×24.
- Wide run: 140×35.
- Portable Unicode framebuffer only; diagnostics reported `GFX cells`.
- No Kitty/Sixel escape path was used.
- Final pass smoke matrix: wide `j`, `j`, Enter, `+`, `-`, `t`, `i`, `r`,
  `s`, `q`; compact `j`, Enter, `+`, `-`, `r`, `q`. Both exited with code 0.

## Normalized live frame

```text
FOCUSED SYSTEM · 7 SESSION ORBIT · GOAL → SESSION

                 routing-review [ ? ]          ! quality-evals [ ! ]

GOAL · Ship a verified model router

▸ router-impl [ ♙ ] ─────────────── ◎ ─────────────── [ ♙ ] fallback-audit
                                  GOAL

human-checkpoint [ ? ]        release-rehearsal [ ✓ ]        rollback-proof [ ♙ ]

only the selected goal-to-session path is drawn; other sessions are spatially
attached without a competing edge bundle. `♙` is a neutral portable agent
mark, not a provider logo.
```

The actual live frame used filled half-block orb bodies rather than this
proportional text representation. The important observed properties were: one
large central goal body occupying roughly a quarter of the usable scene height,
seven directly attached session bodies, a selected `router-impl` orb matching
the inspector title, one solid selected tether, and a single blocked `!` halo.

## Interaction evidence

The following input sequence was exercised without a crash:

- `j`, `j`: moved from `router-impl` to `routing-review`, then
  `quality-evals`; the inspector followed selection.
- Enter: enabled focused-path treatment and kept the selected relationship
  visible.
- `+`, `-`: changed zoom without leaving the framebuffer.
- `h`, `l`, `u`, `d`: moved the scene and remained reversible with `r`.
- `t`: hid and restored diagnostics.
- `i`: hid and restored the inspector; at 80×24 it became a compact bottom
  panel rather than corrupting the terminal.
- `s`: suspended the renderer, showed the cleanup state, resumed after 800 ms,
  and reported `suspend/resume returned cleanly`.
- `r`: restored the default viewport.
- `q`: exited cleanly and restored the alternate screen, cursor, mouse state,
  and bracketed-input state.

## Warmed-up diagnostics

Observed after the renderer had warmed up:

- FPS: 30–31.
- Average frame time: approximately 0.4–0.5 ms in the application diagnostics.
- Nodes: `N 8` (one goal plus seven sessions).
- Update rate: approximately 9.5–10.0 updates/s from the deliberate 100 ms
  pulse tick.
- Graphics capability: `cells`; no enhanced graphics path was needed.

The pulse is intentionally restrained and only belongs to the blocked session.
The rest of the scene is static, which made the result calmer than the frozen
multi-mode rendering POC. The half-block body renderer remained portable:
diagnostics reported `GFX cells`; no Kitty/Sixel/image escape path was used.
