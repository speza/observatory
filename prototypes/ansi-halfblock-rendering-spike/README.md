# ANSI half-block rendering spike — failed direction record

Status: abandoned as a product direction on 2026-08-21.

This directory is now documentation only. The disposable implementation was
purged after evaluation; no runnable code or screenshot artefacts remain. The
observations below are reconstructed from the live Herdr run and are retained
so the decision is explicit rather than looking like an unfinished polish task.

The experiment asked whether a broadly compatible true-colour ANSI software
canvas could provide the high-fidelity observatory experience without Kitty,
Sixel, image protocols, or a browser. It used an offscreen RGB buffer at
terminal columns × twice the map rows and encoded cells with the Unicode upper
half block (`▀`).

The answer is no for the product direction. ANSI can draw an attractive,
rounder scene than a conventional TUI, but achieving and maintaining that
scene makes the application a custom graphics engine with the wrong flexibility
and interaction model for the product.

The product split is now:

- Native TUI: a restrained, keyboard-first operational command centre using
  conventional terminal presentation.
- Later local web UI: the high-fidelity observatory/canvas experience, with a
  real canvas and normal pointer interaction.

The existing OpenTUI experiments and main product documents were not changed by
this decision record.
