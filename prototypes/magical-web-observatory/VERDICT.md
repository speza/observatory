# Renderer bake-off verdict

Status: decided — use native SVG/CSS
Date: 2026-08-24

## Question

Does native SVG/CSS reach the same magical quality bar as PixiJS for the core
Observatory scene, or does PixiJS materially earn its additional renderer?

## Controlled comparison

Both variants use the same React shell, fixture, three Goals, sixteen Agents,
shared logical layout, viewport controls, scenario moments, selection inspector,
motion toggle, visual semantics and art direction. Only the world renderer
changes.

The comparison was previously available as two variants on the disposable POC
route. After the decision, PixiJS and its dependency were removed so the active
prototype could focus on native interaction models. This file preserves the
comparison result and measurements.

## Objective evidence

Production build on 2026-08-24:

- shared React/SVG application chunk: 210.49 kB, 66.68 kB gzip;
- lazy PixiJS renderer chunk: an additional 282.36 kB, 84.25 kB gzip;
- shared CSS: 8.46 kB, 2.84 kB gzip;
- SVG scene implementation: 255 source lines;
- PixiJS scene implementation: 289 source lines; and
- TypeScript plus Vite production build: pass.

The SVG route does not download the lazy PixiJS renderer chunk. PixiJS currently
adds roughly 84 kB gzip and more imperative renderer lifecycle code for this
scene.

## Human comparison

Judge each variant without looking at the renderer label first:

1. Which still frame feels more exceptional?
2. Which motion feels more alive and purposeful?
3. Is the attention beacon clearer in either version?
4. Does selection feel more precise in either version?
5. Does PixiJS enable an effect that materially changes the experience rather
   than merely reproducing SVG?
6. Which stays readable and responsive while panning and zooming across all
   three Goals?
7. Which implementation would you choose if the labels were hidden?

## Decision rule

Choose SVG/CSS unless PixiJS is visibly and materially better. Technical
headroom by itself is not enough; it must improve the product experience in this
scene.

Choose PixiJS if its visual or motion ceiling is clearly higher and the winning
quality would be expensive or fragile to reproduce with SVG/CSS.

Do not decide from bundle size alone. The product decision is whether PixiJS
earns its cost through experienced quality.

## Verdict

Choose native SVG/CSS for the Observatory world.

In the denser three-Goal comparison, native SVG stayed sharp and readable while
zooming and panning. The PixiJS scene became visibly blurry under zoom. Its
initial still frame looked clean, but that advantage did not survive the core
navigation interaction.

PixiJS could compensate by regenerating rasterised text and filter surfaces at
camera-dependent resolutions, at additional complexity and GPU cost. This POC
did not reveal a Pixi-only effect valuable enough to justify that trade-off or
its additional 84.25 kB gzip renderer chunk.

Retain the React semantic HTML shell and use SVG/CSS for the spatial world. Use
normal DOM components for inspectors and, in a future explicitly authorised
terminal experiment, a dedicated terminal renderer rather than either world
renderer.
