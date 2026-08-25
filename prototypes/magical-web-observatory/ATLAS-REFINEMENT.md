# Atlas refinement

Status: Mineral Ledger selected; pre-integration validation active
Date: 2026-08-25

## Question

Can Mineral Ledger make Atlas feel distinctly like Observatory while preserving
operational contrast in light and dark themes?

## Fixed design

The flat cartographic renderer uses Spatial Focus, Attention Queue and a
twelve-Goal, seventy-five-Agent fixture. SVG blur filters and moving trails have been removed. Agent
markers, their halos and attention pulses now share one local coordinate system.

Full Goal titles sit in wrapped cartographic captions outside their bodies.
There are no rectangular label cartouches. Day maps use dark ink over lighter
mineral bodies; Night maps use light ink over deeper versions of the same
pigments.

The central title area now clears decorative terrain and contour marks without
introducing a visible backing shape. External Agent labels use a paper-coloured
text knockout so orbit lines do not pass through their letterforms. State
opacity applies to the Agent marker, not its text label.

Planets are identity and navigation objects rather than circular content cards.
The real Goal model has a human-owned title and optional description, but no
short alias or category. The stress fixture therefore uses realistic multiword
outcome titles rather than project codenames.

Full Goal titles sit in wrapping cartographic captions outside each body. Agent
orbits reserve a caption lane, while the planet itself carries only priority and
Agent count. Selection opens an attached field note containing intent,
operating counts and Agent roster. No title is truncated, silently abbreviated
or forced into the circular geometry.

The SVG uses a container-sized world window rather than a fixed-aspect viewBox.
Expanding the browser reveals more map in both dimensions while planets, labels
and orbit geometry retain a stable screen scale. Smaller viewports reveal less
geography and rely on pan rather than shrinking the complete portfolio.

Operational typography has a readable floor across the Atlas, Attention Queue,
inspector, Ledger and work surface. Seven- and eight-pixel microtype is reserved
for decorative coordinates rather than actionable information.

Entering a Goal closes the Attention Queue, strengthens the selected system and
reveals only that Goal's complete Agent labels. Other systems recede without
disappearing. The field-note roster is interactive, so the user can move from
Goal intent to a specific Agent inspector without returning to the portfolio.

## Palette

Mineral Ledger uses oxide, ochre, verdigris, slate and plum. It supports
`theme=light` and `theme=dark`.

## Evaluation

- Goal and Agent labels remain legible at portfolio and focused zoom.
- Attention is the strongest colour signal in both themes.
- Night mode reads as a dark map, not a return to neon space UI.
- No glow, pulse or marker appears detached from its Agent.
- The palette feels ownable and mature rather than generically AI-branded.
- Small title text reaches at least 4.5:1 against every body colour: Mineral
  Ledger is 4.83:1 or better by day and 4.93:1 or better by night.
- Agent and Goal controls expose names, keyboard activation and visible focus;
  state remains written as text rather than communicated only by colour.
- Catch-up marks affected Goals without rearranging accepted geography and
  provides written new, changed, finished and stale facts.
- Atlas and Ledger render the same fixture so orientation can be compared with
  a strong scanning baseline.
- The simulated work surface proves the map -> Agent -> terminal/diff/evidence
  -> map composition while preserving camera and selection state.

## Verdict

Mineral Ledger is the visual winner. The losing palette implementations and
their switcher have been removed. The ratios above cover the central map
treatment, not a complete WCAG conformance audit of the prototype.
