# Disposable AO Observatory OpenTUI rendering spike

> **THROWAWAY EXPERIMENT — do not promote this code.**
>
> This is an isolated, in-memory rendering POC for deciding whether native
> OpenTUI can make a goal-centred AO universe legible without Chromium or a
> terminal-browser. It deliberately excludes persistence, the AO control plane,
> Herdr, session discovery, and production abstractions.

## Run

From this directory:

```sh
bun install
bun run start
```

The install command is intentionally local to this prototype. The app starts
with a deterministic 21-record fixture: 3 goals and 9 tracked sessions in the
default map, plus 4 repository and 5 worktree execution records kept for an
optional lens. Observation changes are simulated at 10Hz.

The fixture deliberately models V1 as `Goal → tracked Session`. A session may
be shown as a live agent when its process is active, but its identity remains a
session because the process can stop and resume. Repository, branch, worktree,
runtime, host/multiplexer, and context-size data stays on the session as
execution metadata. Repositories and worktrees are not first-class nodes in
the default universe; press `v` to inspect the optional repository-topology
lens. They are never a replacement hierarchy.

## Controls

- `1`, `2`, `3` — switch visual treatments
- `j` / `k`, arrows — move selection
- `h` / `l` — pan left/right; `u` / `d` — pan up/down
- `+` / `-` — zoom the map
- Mouse drag — pan the map; mouse wheel — zoom around the pointer
- `v` — toggle the optional repository/worktree topology lens
- `f` — portable focus lens: selected path or full topology
- `/` or any printable text — type-to-find; `Backspace` edits; `Escape` clears
- `Enter` — focus the selected node in the inspector
- `i` — toggle the inspector
- `t` — toggle diagnostics
- `s` — suspend/resume cleanup smoke test
- `r` — reset pan and zoom
- `q` or `Ctrl-C` — exit cleanly
- Mouse click — select a node when the terminal reports mouse input

The enhanced mode reports its detected terminal graphics capability. It never
uses graphics-only semantics: if Kitty/Sixel/image support is unavailable, it
falls back to the same cell framebuffer and says so in the inspector/status.

Portable mode starts with a focus lens: the selected node's connected
goal/session neighbourhood is bright and ambient topology remains available
but quiet. Press `f` to compare the full topology.

Its current node skin borrows the calmer visual-fidelity spike without
reintroducing its separate scene: goals and sessions use stable rounded
terminal-cell cards, each goal has a subtle colour family inherited by its
sessions, and every goal carries a small circular `◎` core so the Observatory
metaphor survives without forcing rasterised circles onto the terminal grid.
Goals remain the largest objects, selection is a bright card outline, priority
is a stable outline colour, active agents use one quiet activity marker, and
attention uses a restrained pulsing outline plus a `!` status glyph and `!`
label prefix. There are no separate attention arrows competing with labels.
The three modes still change the background, relationship treatment, and
enhanced buffer experiment, but they share this legible card grammar.
Optional repository/worktree records retain the same subordinate rounded
treatment in the infrastructure lens.

The card pass deliberately favours stable cell geometry over literal planets:
rounded rectangles resize, label, and hit-test predictably, while the goal core,
direct orbit layout, focus path, and restrained priority/attention treatments
carry the Observatory language. Wide terminals read materially better; short
terminals now give the map its full height and defer the bottom inspector until
there are at least 26 rows, but dense orbit crossings can still require the
focus lens or a future placement pass.

All modes now use the same deterministic goal-centred layout: goal systems form
a stable triangular field, sessions occupy local orbits around their primary
goal, delegated children sit on a secondary arc around their parent session,
and goal labels prefer a centred position above their card. The default map
contains no repository/worktree row. The optional `v` lens reveals execution
records below the intent map without changing the primary topology. Shared
worktrees and write/write overlap derive typed session relationships and
conflict warnings; they do not create another stored container.

Goals can span repositories. The inspector, search, and optional lens expose
execution metadata when needed while keeping the map centred on intent and
attention.

Nested goals, workstreams, or derived clusters may be explored later only if
real usage demonstrates that the direct goal/session model cannot carry the
needed density.
