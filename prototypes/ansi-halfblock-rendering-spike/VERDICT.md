# Verdict — ANSI half-block rendering spike

**Decision: fail as a product-direction POC; stop implementation.**

This is a failed direction, not an unfinished implementation challenge. The
implementation was purged on 2026-08-21 after evaluation, so no source or
screenshots are available in this directory. The evidence below records what
was actually observed before the purge.

## Observed technical result

The direct renderer did prove that ordinary ANSI true-colour plus `▀` can make
round raster bodies with shading, glow, selected state, blocked state, labels,
animation, and keyboard-driven selection. It did not use OpenTUI boxes or
browser/image protocols.

Observed in the focused Herdr shell pane:

| Measurement | Observation |
| --- | --- |
| Pane | `w3D:p4`, the focused Herdr shell pane |
| Terminal/map size | `191×59` terminal; `191×57` cells; `191×114` RGB pixels |
| Frame rate | approximately 29–30 FPS |
| Render time | approximately 0.7–1.0 ms/frame |
| Output | approximately 20,198–21,503 bytes/frame, roughly 600 KB/s at 30 FPS |
| Renderer CPU/RSS | approximately 3.1% CPU and 67,568 KB RSS in one sample |
| Interaction | keyboard selection, zoom, focus, suspend/resume, resize path, and animation exercised |
| Cleanup | `q` restored the shell; suspend/resume restored the alternate screen |

The measurements show that the approach was technically viable in this local
Herdr setup. They do not make it a good product rendering foundation.

## Why it failed the product bar

1. It turns the application into a small custom graphics engine. Pixel buffers,
   raster shading, antialiasing, dirty-cell encoding, colour state, text
   overlays, cursor movement, alternate-screen lifecycle, and resize handling
   all become application-owned infrastructure.
2. Terminal cells remain the limiting medium. The `columns × rows*2` raster is
   clever, but it is not a real canvas: shape quality, aspect ratio, colour
   fidelity, glyph width, font choice, and terminal passthrough vary by host.
3. Composition is fragile. Labels are manually positioned around moving
   objects, can collide or truncate at smaller sizes, and require a separate
   text layer that can overwrite the raster. Every richer visual treatment adds
   another special case.
4. Resize, raw input, suspend/exit cleanup, and hit testing become part of the
   renderer. Dynamic interaction is possible—SGR mouse reporting could expose
   clicks and wheel events—but it is terminal-dependent and susceptible to
   multiplexer passthrough. It is not browser-like pointer interaction.
5. Output volume is a real concern. The observed roughly 20 KB/frame is fine
   locally but approaches 600 KB/s at 30 FPS before considering remote links,
   terminal parsing, or more complex scenes. Dirty-cell encoding reduced work
   but did not make the model cheap or simple.
6. The result still required design compromises to remain legible. A real
   canvas offers substantially more freedom for scale, layout, labels, pointer
   affordances, transitions, and drill-in behaviour.

## Product decision

Native TUI should be a restrained, keyboard-first operational command centre:
conventional terminal presentation, strong status/attention hierarchy, and
interaction that respects the limits of terminal input and cells.

The later local web UI should own the high-fidelity observatory/canvas
experience. That is where round spatial composition, flexible labels, pointer
interaction, richer animation, and real canvas rendering belong.

This spike should not be revived by adding more ANSI primitives. The next
useful experiment is a product comparison of the restrained native command
centre against the local web observatory, not another terminal graphics pass.
