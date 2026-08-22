# Agent orchestration interface

Exploration of a goal-centred spatial universe for supervising many AI agent
sessions across providers, repositories and git worktrees.

## V0 live Herdr universe

The project-root implementation is a Bun/TypeScript OpenTUI spatial universe
backed by SQLite. It discovers recognized live Herdr agents through
`herdr api snapshot`, keeps human-owned goals, assignments and stable goal
positions across restarts, and focuses a real Herdr session through the
installed CLI. Herdr panes, tabs and workspaces are joined as session metadata
and opaque focus targets; shell-only panes are not AO sessions. The default
database is `data/ao.sqlite`; set `AO_DB_PATH` to use another database.

Install and verify the project:

```sh
bun install
bun run check
bun test
```

Run against the live Herdr instance:

```sh
AO_DB_PATH=/private/tmp/ao-v0-live.sqlite bun run dev
```

For a repeatable dogfood loop without changing the live Herdr host, use the
deterministic mock adapter. It starts with 20 synthetic sessions, adds sessions
over the loop, rotates blocked/waiting/done states, and temporarily drops a
session so AO's stale/recovery path is exercised. The optional portfolio seed
creates three goals and assigns the first sessions through the same Universe
commands used by the TUI:

```sh
bun run dev:mock
```

The script uses `${TMPDIR:-/tmp}/ao-mock.sqlite`. For an explicit disposable
database or a faster scenario tick:

```sh
AO_HOST=mock AO_MOCK_SCENARIO=orbit AO_MOCK_SEED=portfolio \
AO_MOCK_TICK_MS=1000 AO_DB_PATH=/private/tmp/ao-mock.sqlite bun run dev
```

Mock attachment reports success locally but does not focus a real pane. Mock
names, metadata and locators are synthetic; no Herdr session contents are
copied into the scenario. The adapter tests are deterministic and run without
waiting:

```sh
bun test src/hosts/mock/mock.test.ts
```

Oxc owns the committed lint and format configuration (`.oxlintrc.json` and
`.oxfmtrc.json`). The stable quality commands are:

```sh
bun run format       # apply Oxfmt
bun run format:check
bun run lint
bun run lint:fix
bun run check
```

At 80x24 the primary surface is a portfolio, cell-native map of goal bodies and
their direct session satellites. The attention queue, unassigned inbox, flat
grouped list lens and inspector remain supporting lenses. The main controls are:

Unassigned sessions orbit a neutral `INBOX` body on the portfolio map; at
narrow sizes that lens becomes a compact, selectable panel so it does not
overlap goal bodies. Map satellites and inbox cards use identity-derived,
collision-aware perimeter slots, with the inbox orbit expanding when it fills.
The renderer sizes labels from the available cell scale rather than using one
fixed card width. In the full map, each unassigned session has a direct faint
cell tether to the inbox; selected and attention-bearing tethers become
stronger. The focused inbox lens keeps those tethers visible for the whole
orbit, including beyond the first ring. The inbox body is a supporting lens,
not another topology node or a new kind of work object.

Selecting a goal, session or inbox opens a transient floating inspector card
near the selected item. It is clamped inside the map, never reserves a
permanent sidebar, and can be hidden with `i`; `Enter` on a session still
attaches to the real Herdr target. On a narrow terminal the card shortens its
copy and the focused inbox/goal lens is preferred over compressing the whole
universe.

SQLite persists each goal's world position and pinned flag. Refresh and restart
therefore preserve body locations; map pan, zoom, focus and search are client
navigation state, restored across a Herdr attach/return but not written to the
database. New goals use a deterministic free-space scan that considers the
current satellite footprint without reflowing accepted goals. Drag a goal body
to move its persisted anchor; its sessions follow the goal's orbit. Drag empty
map space (or a session card) to pan the viewport. Clicking a goal enters its
goal-only satellite view. Clicking the `INBOX` body, or its header in the
narrow compact panel, enters an inbox-only orbit view; selecting an unassigned
session and pressing `f` does the same.

| Key | Action |
| --- | --- |
| `j` / `k` | Move selection through goal bodies and satellites |
| `h` / `l` | Pan the map left/right |
| `U` / `D` | Pan the map up/down |
| `+` / `-` | Zoom the map |
| `f` / `0` | Focus selected goal or inbox / reset portfolio viewport |
| Mouse click/drag | Click anywhere in a goal body or `INBOX` to focus it; drag a goal body to move it; drag empty space to pan |
| `v` | Toggle the supporting grouped-list lens |
| `A` | Toggle the attention lens; dim healthy work and keep current/uncertain items in spatial context |
| `g` | Jump to the next attention item |
| `z` | Cycle semantic label detail without moving map nodes |
| `Enter` | Focus the selected live Herdr session; return preserves map state |
| `n` | Create a goal (title, description, priority) |
| `r` / `d` | Rename or edit the selected goal/session |
| `p` | Change selected goal priority |
| `a` / `u` | Assign/reassign or unassign a session |
| `c` / `x` | Confirm complete or archive a goal |
| `/` | Search goals and session metadata |
| `R` | Reconcile a fresh Herdr snapshot |
| `i` | Toggle the floating inspector card |
| `s` | Exercise suspend/resume |
| `q` | Cleanly exit |

Documented manual acceptance flow:

1. Start with a new `AO_DB_PATH`; confirm every recognized Herdr agent appears
   in the unassigned inbox and shell-only panes do not. For the scale trial,
   use at least 15 recognized agents when the live environment provides them;
   do not count tabs or non-agent panes as sessions.
2. Create three goals, including a P0 goal; edit a title and description, and
   assign then reassign an inbox session. Confirm the default view shows three
   stable goal bodies, that body size follows session load, and that P0 is a
   distinct persistent priority treatment from attention badges. Drag one goal
   to a new location and confirm its orbit follows; click it or press `f` and
   confirm the focused view shows only that goal and its sessions. Click the
   inbox body/header and confirm the focused view shows only unassigned
   sessions, with a direct tether from the inbox to each visible session;
   select one item and confirm its floating card does not consume permanent map
   area and clicking the card does not pan the map.
   Press `Esc` to return to the portfolio.
   Toggle `A` to inspect the attention lens, and use `z` to cycle overview,
   context and detail labels without changing node positions. With no current
   attention, the lens should remain usable and offer a clear return to the
   portfolio.
3. Exit with `q`, start again with the same database, and confirm the goals and
   assignment remain.
4. Have Herdr report a real pane as blocked, press `R`, and confirm the
   attention row explains the state and elapsed wait. The installed Herdr 0.8
   CLI exposes the reliable human-input state as `blocked`; AO also accepts
   `waiting` from a host adapter. A reversible check is:

   ```sh
   pane_id="<real idle agent pane id from herdr api snapshot>"
   agent_label="<agent field from the same snapshot, usually claude>"
   herdr pane report-agent "$pane_id" --source ao-v0-acceptance --agent "$agent_label" --state blocked --message "AO attention acceptance"
   # run AO and press R
   herdr pane report-agent "$pane_id" --source ao-v0-acceptance --agent "$agent_label" --state idle --message "AO attention acceptance restored"
   ```

   The diagnostic count is shown in the host header. Use an idle pane for this
   check and restore it with `report-agent --state idle`; `release-agent` clears
   Herdr's recognition authority for an existing agent pane in the installed
   Herdr CLI.
5. Use `/` to find a live session; accept the result and confirm the map focuses
   its owning goal and satellite. Press `Enter` to exercise focus/return and
   confirm the selected goal/session, map lens, viewport and search state are
   restored as far as Herdr permits. Use `g` on the blocked session and confirm
   the owning goal is reachable even when the session is outside the portfolio
   viewport; use `A` to review the same item in the attention lens.
6. Complete a goal with `c` and confirmation, observe its dimmed body, then
   archive it explicitly with `x` and confirmation.

The deterministic suites are split into module, projection, SQLite migration/
rollback, layout and sanitized Herdr adapter tests:

```sh
bun run test:herdr
bun run test:all
```

V0 deliberately has no daemon, web UI, provider transcript parsing, quick
message/approval actions, session launch/stop, worktree nodes, relationship
graph beyond direct Goal → Session containment, or Kitty/Sixel/image/raster
rendering. The later web UI may provide higher visual fidelity; the portable
native spatial universe is the primary V0 proof surface.

Design documents:

- [Product design](docs/design/agent-orchestration-map.md)
- [Technical architecture](docs/design/technical-architecture.md)
- [Technology decisions](docs/design/technology-decisions.md)
- [Naming exploration](docs/design/naming.md)

Implementation specifications:

- [V0 live Herdr universe/map](docs/specs/v0-live-herdr-command-centre.md)
