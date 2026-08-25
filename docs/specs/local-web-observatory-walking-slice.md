# Local web Observatory walking slice

Status: command, catch-up and hosted-terminal loops implemented and visually QA'd; human feel sign-off pending
Date: 2026-08-25

## Decision

Observatory now has a maintained local web renderer. It uses React with native
SVG and CSS and consumes the same production projections as the native client.
The Mineral Ledger prototype supplied art-direction evidence only; its fixture
state and component tree are not production dependencies.

The maintained slice is an in-process local control surface. `src/web/main.ts` composes one
`Universe` with the selected `SessionHost`, reconciles that host, serves the
built client on `127.0.0.1`, and polls at the existing snapshot cadence. It is
not a daemon and must not be run concurrently over the same database with
another writable Observatory process.

## Supported surface

- Atlas rendered from `UniverseMapProjection`;
- attention queue and Ledger rendered from `CommandCentreProjection`;
- selection card rendered from `InspectorProjection`;
- browser-local pan, zoom, theme, motion preference, selection and active lens;
- clipped Mineral Atlas surfaces, responsive SVG detail and state-driven motion:
  working orbit traces advance, attention pulses, and uncertain or inactive
  work remains visually quiet;
- one coherent SVG camera transform for goal bodies, labels, satellites and
  orbit geometry, with pointer-anchored wheel zoom;
- a focused-goal spotlight that keeps the selected system crisp while dimming
  and desaturating unrelated work without losing spatial context;
- a readable minimum world scale: constrained viewports expose a pannable
  window onto the larger map instead of compressing all goals into collisions;
- explicit current attention versus stale or unavailable host observations;
- an actionable left-side Inbox lens for real first-run Herdr state (unassigned
  observations stay out of the accepted Goal -> Agent spatial topology); and
- responsive logical world placement with consistently legible SVG bodies and
  external goal titles;
- goal creation, title and description editing, and human priority controls;
- agent assignment and unassignment through the selected agent inspector; and
- explicit goal completion plus confirmed archive for completed goals and
  stale or unavailable agents;
- a durable catch-up checkpoint with semantic changes grouped into new,
  changed, attention, finished and stale outcomes; and
- a transient xterm.js surface over a host-owned terminal session, with the
  selected Agent and map state left intact beneath the overlay.
- host-owned terminal scrolling from web wheel and PageUp/PageDown gestures;
  scroll requests remain generic terminal capabilities and do not become agent
  input or browser-local fake scrollback;

The web surface also carries the useful keyboard-first parts of the native
renderer: `j`/`k` or arrow keys move through Goal and Agent selection, `Enter`
focuses a Goal or opens the selected Agent terminal, `Space`/`f` focuses the
current map item, `+`/`-`/`0` control the camera, and `h`/`l`/PageUp/PageDown
pan it. `a` opens the attention queue, `g` jumps to the next attention item,
`v` switches Atlas/Ledger, `n` opens New goal, `i` toggles the inspector, `t`
opens the selected Agent terminal, and `Esc` closes the topmost surface before
clearing selection. A `?` guide is available in the masthead. Pointer users
can click a goal to focus it, or click an agent to enter its parent goal and
select it. Selecting a child agent while its goal is focused keeps the goal
spotlight and camera fixed. Double-click/keyboard focus can still center the
exact rendered agent marker. Empty-field clicks clear the selection.

The loopback API exposes only:

- `GET /api/portfolio` — universe-map, command-centre and catch-up projections
  generated from the same `Universe`; and
- `GET /api/inspector?type=goal|agent&id=...` — the existing inspector
  projection; and
- `POST /api/commands` — a browser-specific allow-list that maps goal and
  assignment actions onto existing `Universe` commands and returns the fresh
  portfolio with the accepted command result;
- `POST /api/terminal/open` — resolves an active Agent through the generic
  `SessionHost` capability and opens a host-owned terminal;
- `GET /api/terminal/:session/events` — streams bounded replay plus live
  terminal frames as server-sent events, with comment keepalives for quiet
  sessions; and
- `POST /api/terminal/:session/input|resize|release` — submits narrow terminal
  capabilities to that host-owned session.

The mutation endpoint accepts JSON only when both the exact loopback `Origin`
and explicit `X-AO-Command: 1` intent header match. It does not expose layout,
reconciliation, host or persistence operations. Other paths return `404` and
unsupported methods return `405`. The browser imports projection and web
protocol types only. It must not import SQLite, a concrete host adapter or the
mutable `Universe`.

The terminal session identifier is an unguessable, process-local capability.
Input, resize and release use the same exact-origin JSON mutation boundary as
Universe commands. The event stream is read-only and contains terminal frames
only. The server releases all open sessions during shutdown. This is loopback
capability isolation, not remote-user authentication, and therefore does not
make Observatory a remotely accessible or multi-user service.

The catch-up history belongs to the core. `Universe` records accepted semantic
transitions with a monotonically increasing sequence and persists one operator
checkpoint. `CatchUpProjection` groups only records after that checkpoint and
shows the latest outcome per affected Goal or Agent while retaining the raw
accepted-transition count. Repeated runtime movement therefore does not turn
the headline into an unusable event total. Acknowledgement is an explicit Universe command; polling or opening the lens
never advances the checkpoint. This is an operator catch-up record, not a
general audit log or transcript store.

## Explicit exclusions

- No general-purpose CRUD API, arbitrary Universe command endpoint, event
  subscription, WebSocket, Electron shell or long-running daemon.
- No client-side graph engine or browser-owned semantic layout.
- No terminal scrollback persistence, transcript ingestion, remote access,
  browser-created PTY or concrete Herdr protocol in the web client.

## Acceptance evidence

- `bun run check` passes maintained source, web types and boundary lint.
- `bun test` passes the complete control-plane and renderer suite.
- `bun run build:web` produces the static browser client.
- The clean-room `portfolio` mock reconciles 75 agents, assigns 71 through
  `Universe` commands to 12 pinned goals and leaves four unassigned.
- The second deterministic mock frame makes those four observations stale;
  they remain present as uncertainty rather than current human attention.
- Static SVG rendering at the 1200×760 reference viewport contains all 12 goals
  and 75 agents without overlapping goal bodies.
- Decorative planetary material remains clipped to each goal body, while
  labels and attention marks remain intentionally external. Planet surfaces
  are flat mineral colour without gradient or glow effects.
- Every assigned agent marker is derived from the same ellipse geometry used to
  draw its visible orbit line. Unassigned observations are rendered by the
  supporting Inbox list rather than as a semantic map node.
- Agent focus uses that same rendered orbit position, so keyboard and explicit
  double-click camera moves center the visible marker rather than its raw map
  anchor. A single click inside an already focused goal is selection-only.
- Goal orbits reserve a caption corridor beneath the planet, and the selection
  inspector floats over the field without changing the world fit or camera.
- Focus mode spotlights one goal or agent system, preserves nearby map context,
  and returns to the full atlas on reset or empty-field clear.
- Agent runtime states have a visible map grammar and key: working is active
  teal, idle is neutral, and human-review attention carries an accent badge.
- Attention totals are labelled explicitly inside goal bodies; decorative
  marks do not resemble semantic nodes. Global zoom does not reveal every
  agent label—expanded detail is scoped to the selected goal.
- The scale fixture uses stable, irregular accepted goal positions rather than
  runtime randomness or a perfectly uniform grid.
- Motion can be disabled explicitly and also honours the operating system's
  reduced-motion preference.
- A live Herdr smoke on 2026-08-25 reconciled 14 agents and returned both
  universe-map and command-centre projections through the same loopback path.
- A disposable live-Herdr command smoke on 2026-08-25 created one goal, assigned
  one of 14 observed agents through the loopback gateway, and immediately
  returned the updated one-goal/13-unassigned projection without changing the
  normal Observatory database.
- Disposable Chrome renders on 2026-08-25 confirmed wide and constrained Atlas
  composition, both themes, enlarged non-map typography, the floating
  inspector, new-goal modal, catch-up lens and a live mock xterm.js frame. The
  terminal and catch-up overlays temporarily hide, but do not clear, the
  inspector so no stacked borders or world displacement leak through.
- Agent labels are decluttered by a deterministic attention/selection budget;
  stale or idle markers remain selectable without rendering every long label at
  once.
- Web terminal wheel and PageUp/PageDown requests use the existing host-owned
  scroll input contract.
- Final human feel sign-off should still exercise physical pan/zoom and the
  complete create/edit/assignment/archive workflow in the attached browser.
- API contract tests prove same-origin command rejection, schema validation,
  the browser command allow-list, refreshed projection responses and domain
  rejection without browser access to mutable internals.
- Persistence and projection tests prove catch-up survives restart, filters at
  the acknowledged sequence and remains deterministic.
- Terminal API tests prove host-owned frame streaming, text input, resize,
  release and foreign-origin rejection through the deterministic mock host.

## Commands

```sh
bun run web:mock
bun run web
```

Both commands build the client before starting the loopback server. Use a
separate `AO_DB_PATH` for disposable live smoke tests.
