# Observatory

An agent observatory: a goal-centred spatial universe for supervising many AI
agent executions across providers, repositories and git worktrees.

## V0 live Herdr universe

The project-root implementation is a Bun/TypeScript OpenTUI spatial universe
backed by SQLite. It discovers recognized live Herdr agents through
`herdr api snapshot`, keeps human-owned goals, assignments and stable goal
positions across restarts, and directly attaches to a real Herdr Agent through
the installed CLI. Herdr panes, tabs and workspaces are agent metadata and
opaque attachment targets; shell-only panes are transient linked executions,
not durable Observatory Agents. When Herdr exposes its controller stream, `t`
opens a host-owned embedded terminal inside the TUI; `y` opens a linked shell or
sibling Agent beside the map or primary terminal. `Tab` changes input focus,
`Ctrl-Shift-Y` opens the linked picker from a terminal, and `Enter` remains the
foreground-native fallback.
The default
database is `data/ao.sqlite`; set `AO_DB_PATH` to use another database.

Herdr is intentionally required for the first live product slice, not baked
into the control plane. The `SessionHost` seam keeps future tmux,
Superlogical-style or Observatory-owned hosts replaceable; `AO_HOST=mock`
exercises the same path without a live Herdr instance.

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

The terminal-surface experiments remain disposable and do not add managed
agents or persistence. POC A starts a local shell inside an OpenTUI terminal
panel; POC B renders a selected Herdr agent through Herdr's observe/control
stream. Press Ctrl-Q to leave either prototype:

```sh
bun run dev:pty-poc
AO_HERDR_TARGET=<agent-or-pane-id> bun run dev:herdr-terminal-poc
AO_HERDR_MOCK=1 bun run dev:herdr-terminal-poc
```

Their scope and current evidence are recorded in
[Native terminal surface POCs](docs/specs/terminal-surface-pocs.md).

For a repeatable dogfood loop without changing the live Herdr host, use the
deterministic mock adapter. It starts with 20 synthetic Agents, adds Agents
over the loop, rotates blocked/waiting/done states, and temporarily drops a
Agent so Observatory's stale/recovery path is exercised. The optional portfolio seed
creates three goals and assigns the first Agents through the same Universe
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
names, metadata and locators are synthetic; no Herdr agent contents are
copied into the scenario. The adapter tests are deterministic and run without
waiting:

```sh
bun test src/hosts/mock/mock.test.ts
```

Oxc owns the committed lint and format configuration (`.oxlintrc.json` and
`.oxfmtrc.json`). The stable quality commands are:

```sh
bun run format       # format every supported maintained file; run before handoff
bun run format:check # verify repository-wide formatting without writing
bun run lint
bun run lint:fix
bun run check        # required before commit or agent handoff
```

The maintained source is checked by the vendored Anti-Slop Oxlint plugins in
`tools/oxlint/anti-slop/`. Effect is used for the asynchronous host/runtime
edge: `SessionHost` operations are typed Effects, terminal output is a
cancellable Effect Stream, and the pure universe model remains ordinary
TypeScript. Disposable prototypes are excluded from the production lint/format
gate. Optional capabilities follow the proposed [plugin architecture](docs/design/plugin-architecture.md)
so external work references and future hosts do not become kernel-specific
special cases.

Oxlint treats correctness and suspicious findings as errors, reports
performance findings as warnings, checks imports, and runs type-aware promise
rules. Broad stylistic and pedantic categories remain disabled so Oxfmt owns
presentation and lint output stays actionable.

At 80x24 the primary surface is a portfolio, cell-native map of goal bodies and
their direct Agent satellites. The attention queue, unassigned inbox, flat
grouped list lens and inspector remain supporting lenses. The main controls are:

Unassigned Agents are hidden from the portfolio map by default. The header
shows an `INBOX !N · v list` warning whenever Agents need organising; `v`
opens the supporting grouped list. `A` or focusing an inbox item exposes the
attention-first inbox list, and the goal-level `a` picker supports
type-to-filter assignment. The inbox remains a supporting lens rather than a
topology node or a new kind of work object. Goal satellites use stable,
identity-derived positions on the portfolio map.
Stale or unavailable Agents remain visible in the list and attention lenses;
select one and press `x` to confirm archiving it from active views. Archiving
keeps its history and assignment, and a later Herdr refresh updates its facts
without silently restoring it.
Live-but-idle Agents use a dot; actively working Agents use a rotating
half-moon marker and restrained green border pulse. Herdr's transient working
marker is removed from the Agent name before Observatory adds its own.
On a clean database, the map shows an onboarding prompt: create a goal with
`n`, then press `a` to assign Agents from it.

Selecting a goal or Agent opens a transient floating inspector card
near the selected item. It is clamped inside the map, never reserves a
permanent sidebar, and can be hidden with `i`; `Enter` on an Agent still
attaches to the real Herdr target. On a narrow terminal the card shortens its
lower-priority copy while preserving the selected title, and the focused
goal/list lens is preferred over compressing the whole universe. Creating a
goal selects it automatically; `a` then opens an inbox
picker so Agents can be assigned without first navigating to an individual
Agent.

SQLite persists each goal's world position and pinned flag. Refresh and restart
therefore preserve body locations; map pan, zoom, focus and search are client
navigation state, restored across a Herdr attach/return but not written to the
database. New goals use a deterministic free-space scan that considers the
current satellite footprint without reflowing accepted goals. Drag a goal body
to move its persisted anchor; its Agents follow the goal's orbit. Drag empty
map space (or an Agent card) to pan the viewport. Clicking a goal enters its
goal-only satellite view. Selecting an unassigned Agent and pressing `f`
opens the supporting inbox list lens. Clicking empty map space clears the
selection and floating inspector.

On the portfolio map, `j`/`k` cycles goal bodies only. After focusing a goal,
`j`/`k` cycles that goal's Agents clockwise around the body; the inbox lens
cycles its unassigned Agents. The grouped list keeps its flat row navigation.

| Key              | Action                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `j` / `k`        | Portfolio: cycle goals; focused goal/inbox: cycle Agents                                             |
| `h` / `l`        | Pan the map left/right                                                                               |
| `U` / `D`        | Pan the map up/down                                                                                  |
| `+` / `-`        | Zoom the map                                                                                         |
| `f` / `0`        | Focus selected goal or inbox list / reset portfolio viewport                                         |
| Mouse click/drag | Click a goal to focus it; drag a goal body to move it; drag empty space to pan and clear selection   |
| Right-click      | Open the context menu without changing the primary selection; choosing an action promotes its target |
| `v`              | Toggle the supporting grouped-list lens                                                              |
| `A`              | Toggle the attention lens; dim healthy work and keep current/uncertain items in spatial context      |
| `g`              | Jump to the next attention item                                                                      |
| `z`              | Cycle semantic label detail without moving map nodes                                                 |
| `t`              | Open the selected Agent in the embedded host terminal; Ctrl-Q/Esc releases back to the map           |
| `y`              | Open a linked shell or sibling Agent; choose from the picker when several are available              |
| `Tab`            | Cycle map, primary-terminal and linked-terminal focus                                                |
| `Ctrl-Shift-Y`   | Open the linked-execution picker while a terminal is focused                                         |
| `Ctrl-Shift-R`   | Refresh the host snapshot while a terminal is focused                                                |
| `Enter`          | Attach directly to the selected live Herdr Agent; detach to return with map state                    |
| `n`              | Create a goal (title, description, priority)                                                         |
| `r` / `d`        | Rename or edit the selected goal/Agent                                                               |
| `p`              | Change selected goal priority                                                                        |
| `a` / `u`        | Assign from a selected goal/Agent or unassign an Agent                                               |
| `c` / `x`        | Confirm complete/archive a goal, or archive a stale Agent                                            |
| `/`              | Search goals and Agent metadata                                                                      |
| `R`              | Reconcile a fresh Herdr snapshot                                                                     |
| `i`              | Toggle the floating inspector card                                                                   |
| `s`              | Exercise suspend/resume                                                                              |
| `q`              | Cleanly exit                                                                                         |

Documented manual acceptance flow:

1. Start with a new `AO_DB_PATH`; confirm every recognized Herdr agent appears
   in the unassigned inbox and shell-only panes do not become Agents. For the scale trial,
   use at least 15 recognized agents when the live environment provides them;
   do not count tabs or non-agent panes as Agents.
2. Create three goals, including a P0 goal; edit a title and description. Each
   new goal should become selected, and pressing `a` should open a searchable
   picker of inbox Agents. Assign several Agents from that picker, then
   reassign one Agent through the Agent-to-goal picker. Confirm the default
   view shows three stable goal bodies, no inbox cards, and an `INBOX !N · v
list` warning; goal size follows Agent load, and P0 is a distinct
   persistent priority treatment from attention badges. Drag one goal to a new
   location and confirm its orbit follows; click it or press `f` and confirm
   the focused view shows only that goal and its Agents. Select an inbox item
   and confirm its floating card does not consume permanent map area; click
   empty map space and confirm the selection and card clear.
   Press `Esc` to return to the portfolio.
   Toggle `A` to inspect the attention lens, and use `z` to cycle overview,
   context and detail labels without changing node positions. With no current
   attention, the lens should remain usable and offer a clear return to the
   portfolio.
3. Exit with `q`, start again with the same database, and confirm the goals and
   assignment remain.
4. Have Herdr report a real pane as blocked, press `R`, and confirm the
   attention row explains the state and elapsed wait. The installed Herdr 0.8
   CLI exposes the reliable human-input state as `blocked`; Observatory also accepts
   `waiting` from a host adapter. A reversible check is:

   ```sh
   pane_id="<real idle agent pane id from herdr api snapshot>"
   agent_label="<agent field from the same snapshot, usually claude>"
   herdr pane report-agent "$pane_id" --source observatory-v0-acceptance --agent "$agent_label" --state blocked --message "Observatory attention acceptance"
   # run Observatory and press R
   herdr pane report-agent "$pane_id" --source observatory-v0-acceptance --agent "$agent_label" --state idle --message "Observatory attention acceptance restored"
   ```

   The diagnostic count is shown in the host header. Use an idle pane for this
   check and restore it with `report-agent --state idle`; `release-agent` clears
   Herdr's recognition authority for an existing agent pane in the installed
   Herdr CLI.

5. Use `/` to find a live Agent; accept the result and confirm the map focuses
   its owning goal and satellite. Press `Enter` to exercise focus/return and
   confirm the selected goal/Agent, map lens, viewport and search state are
   restored as far as Herdr permits. Use `g` on the blocked Agent and confirm
   the owning goal is reachable even when the Agent is outside the portfolio
   viewport; use `A` to review the same item in the attention lens.
6. Select an Agent, press `y`, and choose among the available shell and sibling
   Agent links. Confirm the linked surface opens inside Observatory beside the
   map. Open the primary Agent terminal too and confirm both terminals remain
   visible; use `Tab` and mouse clicks to move focus, then run `pwd` or a
   preferred diff tool in the linked shell. `Ctrl-Shift-R` refreshes while a
   terminal is focused; a later host snapshot should promote a linked shell
   started with Claude, Codex or Pi into a normal Agent without creating a
   durable shell node.
7. Stop or hide a test agent so it becomes stale, select it from the list or
   attention lens, then archive it with `x` and confirmation. Confirm it leaves
   active projections while its identity and assignment remain persisted.
8. Complete a goal with `c` and confirmation, observe its dimmed body, then
   archive it explicitly with `x` and confirmation.

The deterministic suites are split into module, projection, SQLite migration/
rollback, layout and sanitized Herdr adapter tests:

```sh
bun run test:herdr
bun run test:all
```

V0 deliberately has no daemon, web UI, provider transcript parsing, quick
message/approval actions, worktree nodes, relationship graph beyond direct
Goal → Agent containment, or Kitty/Sixel/image/raster rendering. Native diff
rendering is also deferred: use a linked shell to run the person's preferred
diff/review tool. The later web UI may provide higher visual fidelity; the
portable native spatial universe is the primary V0 proof surface.

Design documents:

- [Product design](docs/design/agent-orchestration-map.md)
- [Technical architecture](docs/design/technical-architecture.md)
- [Technology decisions](docs/design/technology-decisions.md)
- [Naming exploration](docs/design/naming.md)

Implementation specifications:

- [V0 live Herdr universe/map](docs/specs/v0-live-herdr-command-centre.md)
