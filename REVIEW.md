# Review: derived-view layer — projection, attention, spatial

Scope: `src/projection/projection.ts`, `src/projection/types.ts`,
`src/attention/attention.ts`, `src/spatial/positions.ts`,
`src/spatial/viewport.ts` and their tests. Review-only: no source files were
modified and nothing was committed.

Context read: `AGENTS.md`, `docs/design/technical-architecture.md`,
`docs/design/agent-orchestration-map.md` (search only), plus the consuming
`src/web/portfolio.ts`, `src/web/projection-publisher.ts` and
`web/src/atlas/{useAtlasCamera,atlasGeometry}.ts` for impact assessment.

Evidence run:

- `bun test src/projection/projection.test.ts src/attention/attention.test.ts src/spatial/positions.test.ts src/spatial/viewport.test.ts` → 51 pass, 0 fail.
  (A path-based `bun test src/projection src/attention src/spatial` also picks
  up `web/src/attention/CatchUpPanel.test.tsx`, which fails for an unrelated
  missing `react/jsx-dev-runtime`; not in scope.)
- Disposable synthetic probes under the temp dir (not committed) for scale,
  comparator, overflow, and viewport edge cases. Numbers quoted below are from
  those probes.

Overall assessment: module boundaries and purity are respected — none of the
reviewed files import SQLite, `Effect`, or concrete host adapters, and
`projection.ts` never touches persistence. The projection layer preserves
uncertainty well for the default (non-archived) paths. The real problems are
(i) spatial layout that silently degrades at moderate universe sizes,
(ii) comparator/viewport defects that are masked by narrow tests, and
(iii) unbounded projection size/cost with no graceful degradation.

## High

### H1. `initialGoalMapPosition` silently emits duplicate durable positions once the fixed grid is exhausted

`src/spatial/positions.ts:146-205` (`goalCandidates` ring 0..16,
`initialGoalMapPosition` fallback at 203-204), consumed by Universe goal
creation (`src/universe/universe.ts:1278`, `1343`) and reset.

Why it matters: when every candidate in the fixed ±16 grid fails the overlap
check, the function returns `goalCandidates(goalId).at(-1)` — the same far grid
corner for every overflow goal. Duplicates become durable `goal.mapPosition`
values, so goal bodies and satellites render on top of each other, and later
`repairGoalMapPosition` only repairs unpinned goals when they are explicitly
repaired. Measured with the real functions:

- 0 agents/goal: first duplicate at goal index 289; 500 goals → 211 duplicate
  placements, 289 unique.
- 10 agents/goal (footprint ring 2): 81 unique placements, first duplicate at
  goal index 81.

That is well within a plausible multi-repository universe, not a theoretical
limit.

Proposed fix: do not cap the search at ring 16. Generate candidate rings on
demand until a non-overlapping slot is found (loop is already deterministic),
with a safety bound tied to the number of occupied entries. If a fallback is
truly needed, make it offset from the crowded region (e.g., extend the searched
ring and keep a deterministic per-goal hash jitter) and surface an explicit
diagnostic/flag instead of silently reusing a position.

### H2. Satellite and inbox layouts cap at 120 and collapse overflow agents onto the anchor

`src/spatial/positions.ts:88-117` (`SATELLITE_OFFSETS` rings 1..5 = 120 slots,
`INBOX_OFFSETS` rings 1..4 = 120 slots), `stableSlotPositions`
`src/spatial/positions.ts:46-81`, callers `src/projection/projection.ts:543`
(`?? mapPosition`) and `src/projection/projection.ts:564` (`?? inboxPosition`).

Why it matters: `stableSlotPositions` leaves ids without a slot when offsets run
out, and every caller falls back to the goal/inbox anchor. Confirmed:
`agentSatellitePositions(..., 130 ids)` assigns 120; the other 10 all render at
the goal centre. Inbox behaves identically. This is silent visual identity loss
for exactly the busy goals the spatial product bet is meant to make legible.

Proposed fix: generate offsets lazily per ring (the generator loops are already
parameterised by ring) so `offsets.length` is always ≥ `ids.length`, or fall
back to a deterministic hash-derived 2D position rather than the anchor. Never
return a map missing a requested id without the caller handling overflow
explicitly.

### H3. Full projections exceed the SSE event cap and the cost is superlinear in goals × agents

`src/web/projection-publisher.ts:16` (`MAX_SERIALIZED_EVENT_BYTES = 5 MiB`),
`41-43` (throws when exceeded), `src/web/portfolio.ts:22-25` (both command
centre and map built per batch), `src/projection/projection.ts:149` (per-goal
`views.filter`), `170-184` (per-system `goals.filter`, plus a full
`views.filter` for stale count).

Why it matters: the browser bootstrap/reconnect path carries complete
projections, not deltas. Measured on synthetic states:

- Serialized `projectCommandCentre` size: 1k agents ≈ 0.54 MiB; 10k agents
  ≈ 5.43 MiB (already over the 5 MiB cap); 30k agents ≈ 16.4 MiB. The
  publisher throws instead of degrading.
- Derivation time: 2k agents / 200 goals ≈ 6.7 ms; 10k / 1k ≈ 55 ms;
  30k / 3k ≈ 473 ms; 50k / 1k ≈ 559 ms. The portfolio derives on every
  batched change, synchronously on the server event loop.

Proposed fix, in order of leverage:

1. Index once: build `Map<goalId, AgentView[]>` in a single pass and reuse it
   for goal views, system roll-ups and counts. This removes the G×A filters
   (the dominant cost).
2. `projectCodeContexts` / `projectCodeContextMap` / `projectRelatedAgents`
   each call `projectCommandCentre` again (`projection.ts:250`, `314`, `390`);
   derive once and reuse within a request/portfolio.
3. Bound the payload (top-N by attention, per-system summaries) before
   serialization and replace the hard throw with a bounded/partial projection
   plus an explicit "truncated" flag.

### H4. `panViewport` clamps the camera centre to ±500 world units, contradicting accepted durable extents

`src/spatial/viewport.ts:74-75`; world extents accepted by
`isMapPosition` (`src/spatial/positions.ts:284-288`, ±10,000) and used by
`repairGoalMapPosition`/`initialGoalMapPosition` (grid can exceed ±1,000).

Why it matters: `fitViewportToPoints` can legitimately produce a centre beyond
±500 (content or pinned Goal positions can be at ±10,000). Any subsequent pan —
even a zero-delta pan — snaps the centre to ±500. Confirmed:
`panViewport({ center: { x: 2000 } }, { x: 0, y: 0 })` returns `{ x: 500 }`.
The camera jumps ~1,500 world units, losing the user's place.

Proposed fix: derive the clamp from the actual world bounds (or from the
maximum accepted extent, e.g. ±`isMapPosition` limit plus padding), or drop the
clamp and rely on `isMapPosition` for durable positions and a separate
renderer-local bound. Regardless, `panViewport` must not be the narrowest limit
in the system.

### H5. `compareAgents` host-health comparator is not antisymmetric; ordering depends on input order

`src/projection/projection.ts:50-57`, specifically line 55
(`left.hostHealth === "live" ? -1 : 1`).

Why it matters: for two different non-live health values
(`stale` vs `unavailable`) the comparator returns `1` in both argument orders.
It is not a total order. With a stable sort the resulting order is just the
input order, and non-live ordering is inconsistent with `hostFor`'s rank
(`unavailable: 0, stale: 1, live: 2` at `projection.ts:62`): live sorts first,
then unavailable, then stale. Confirmed: agent input order
`[stale, unavailable]` and `[unavailable, stale]` both come out unchanged.

Proposed fix: replace the ternary with an explicit rank, e.g.
`const hostRank = { live: 0, stale: 1, unavailable: 2 }`, and compare ranks.
Add a test that asserts `f(a, b) === -f(b, a)` for the three health values.

## Medium

### M1. Satellite/inbox positions move when a newly added agent id sorts earlier

`src/spatial/positions.ts:55-79` (sorted ids + occupancy-dependent probing),
`243-248`, `274-278`; test gap at `src/spatial/positions.test.ts:34-43`.

Why it matters: the comment at `positions.ts:238-242` claims added agents do
not disturb existing satellites, but the test only appends `agent-z`. A new id
that sorts before existing ids can claim an existing probe target and push the
existing agent to a different slot. Confirmed by brute force: inserting
`agent-a0003` moved `agent-z` from `(0,24)` to `(-32,24)`; inserting
`agent-a0004` moved `agent-m`. Cards visibly jump when unrelated agents are
admitted into the same goal.

Proposed fix: make slot assignment order-independent — e.g. a larger derived
slot space via double hashing (`hash(id)` and a second `hash(id + ":probe")`
offset), so each agent's position depends only on its own id and collisions are
resolved without consulting other agents' assigned slots, or persist the slot
in Universe state like goal positions.

### M2. `fitViewportToPoints` propagates NaN/Infinity into center and zoom

`src/spatial/viewport.ts:34-52`; `screenPointForWorld` `56-64`.

Why it matters: any non-finite coordinate makes `Math.min`/`Math.max` return
NaN, `clamp(NaN, …)` returns NaN, and every subsequent `screenPointForWorld`
returns NaN. Confirmed: one `NaN` or `Infinity` point yields
`center.x = NaN`/`Infinity`, `zoom = NaN`. Durable positions are validated by
`isMapPosition`, but viewport callers may pass renderer-derived points.

Proposed fix: filter non-finite points at the top (`points.filter(isFinite)`)
or return the identity viewport `{ center: { x: 0, y: 0 }, zoom: 1 }` when any
input is invalid. Guard `screenPointForWorld` similarly or document the
precondition and enforce it at the call site.

### M3. `src/spatial/viewport.ts` is test-only; production camera duplicates the math with different constants

`src/spatial/viewport.ts:1-103` is imported only by
`src/spatial/viewport.test.ts`; no `src/` or `web/` production module imports
it. The real renderer camera is
`web/src/atlas/useAtlasCamera.ts:46-67` (`fitAtlasBounds`) and `236-336`
(pan/zoom), with different constants (`MINIMUM_ZOOM = 0.12`,
`MAXIMUM_ZOOM = 2.8` at lines 42-44 vs `0.65`/`2.2` in
`src/spatial/viewport.ts:20-21`). `hash` is duplicated verbatim in
`web/src/atlas/atlasGeometry.ts:31-38` and `src/spatial/positions.ts:35-42`.

Why it matters: the tested viewport math does not protect the shipped camera,
and the two implementations can (and do) diverge. Tests passing here give false
confidence for camera behaviour.

Proposed fix: either make the renderer consume `src/spatial/viewport.ts`
(keeping the pure math in one place and viewport state renderer-local, per the
architecture) or delete the module and add equivalent unit coverage for the
camera helpers in `web/src/atlas/`. De-duplicate `hash` similarly.

### M4. Renderer projections expose native host identifiers, contrary to the host-opacity rule

`src/projection/projection.ts:104-106` (`execution: { hostKind, nativeId }`),
`942` (`native ${agent.execution?.nativeId}`), `src/projection/types.ts:63`
and `71`; consumed at `web/src/inspector/Inspector.tsx:59,422`; the full
`executionContainer` (id + observed label) also rides along via the
`...publicFields` spread.

Why it matters: `AGENTS.md:42-48` says host identifiers and attachment targets
remain opaque outside the adapter and "native identifiers … must not enter …
`projection/` or renderer interfaces". The renderer only displays/copies
`nativeId`; nothing in the UI needs the raw host id. The inspector's
`conversation.id` exception is explicitly gated, but the host id is not.

Proposed fix: strip `nativeId` (and `executionContainer.id`) from
`AgentView`/inspector output, or expose an opaque display label/token if the
renderer must show something. If the id must stay for supportability, document
the deliberate exception in `docs/design/technical-architecture.md` and update
`AGENTS.md` so the rule and the code agree.

### M5. `includeArchived` projections invent human attention for already-settled archived agents

`src/attention/attention.ts:226-245` (`ended-externally` fires for any agent
with a `primaryGoalId` and `executionPresence === "absent"`) combined with
`src/projection/projection.ts:124-131` passing all agents when
`includeArchived` is true.

Why it matters: an Agent with `archivedAt` set, `executionPresence: "absent"`
and `observationHealth: "fresh"` is returned with a `requiresHumanInput`
`ended-externally` item ("Review or archive its durable record") even though it
is already archived. Confirmed with `projectCommandCentre(..., includeArchived:
true)`. There is currently no production caller of `includeArchived`
(`src/web/api.ts` never passes it and `web/src` never requests it), so this is
latent, but it is part of the exported projection contract and the tests at
`src/projection/projection.test.ts:525-553` only assert goals/counts, not
attention.

Proposed fix: gate `ended-externally` on `agent.archivedAt === undefined` (and
arguably on the primary Goal not being archived), or skip archived settled
agents entirely in `evaluateAttention` when the projection requested archived
context. Extend the existing `includeArchived` test to assert
`attention.items` is empty for settled archived agents.

### M6. `projectSearch` materializes every result before the API slices it

`src/projection/projection.ts:580-634` (builds all matches, no limit), sliced
only at `src/web/api.ts:289` (`MAXIMUM_SEARCH_RESULTS = 50`). `now` is required
by the query type but unused (`src/projection/types.ts:41`).

Why it matters: the projection is O(goals + agents) with string building per
entity on every keystroke. Measured: 50k matching agents ≈ 30 ms and 50,000
`SearchResult` objects constructed, 49,950 of which are immediately discarded.
The architecture explicitly calls for bounded search results
(`docs/design/technical-architecture.md:472`).

Proposed fix: accept an optional `limit` in the query (default 50) and stop
scanning once reached, or push the bound into the projection for the API edge.
Drop the unused `now` from the search query to keep the contract honest.

### M7. Catch-up scans the entire change history on every projection

`src/projection/projection.ts:750-751` (`state.changes.filter(sequence >
lastSequence)`), `759-769` (groups all unread), with history explicitly
unbounded (`docs/design/technical-architecture.md:452-453`: retention and
compaction are post-V1).

Why it matters: measured 500k changes ≈ 50 ms per catch-up projection, and the
portfolio derives it on every batched change. Cost grows without bound as the
operator history accumulates, on the same event loop that serves SSE.
`projectPortfolio` also always derives catch-up even when the renderer only
needs map/command-centre.

Proposed fix: since `changes` is append-ordered, binary-search the first
sequence > checkpoint (`.findIndex` scan is the current cost) instead of
filtering the full array, and/or persist a compaction watermark. Longer term,
retain only the tail needed by the checkpoint plus a bounded window.

### M8. `Math.min(...array)` / `Math.max(...array)` can overflow the call stack

`src/spatial/viewport.ts:35-38` and `src/spatial/positions.ts:266-267`.

Why it matters: argument spreading is bounded by the engine's max arguments.
Confirmed: `fitViewportToPoints` with 1,000,000 points throws
`Maximum call stack size exceeded`; 200k works. `mapInboxAnchor` spreads every
goal + satellite position, so the same ceiling applies to map projection with a
very large universe.

Proposed fix: compute extrema with `for…of` loops (or `reduce`) rather than
spread. That also avoids the intermediate `.map` allocation.

### M9. Inspector transcript-path guard misses Windows/UNC backslash paths

`src/projection/projection.ts:926-935`.

Why it matters: the guard rejects `kind` containing "path" and values starting
with `/` or a drive letter, but not values beginning with `\\`
(`\\server\share\transcript.jsonl`). Test coverage only exercises a POSIX path
(`src/projection/projection.test.ts:119-148`). This is the one output path where
raw provider references are surfaced, so the guard should be conservative.

Proposed fix: also reject `value.startsWith("\\")` (and ideally treat any
value with a path separator plus a transcript-like extension as unsafe). Add a
UNC fixture to the existing privacy test.

## Low

### L1. Locale-dependent ordering and case folding make projections environment-sensitive

`localeCompare` at `src/projection/projection.ts:56`, `63`, `166`, `188`,
`289`, `485-486`, `852` and `src/spatial/positions.ts:55`, `229`;
`toLocaleLowerCase` at `projection.ts:578`, `587` and `attention`-adjacent
search paths.

Why it matters: projections are specified as deterministic, but
`localeCompare`/`toLocaleLowerCase` without an explicit locale depend on the
host runtime's default locale (e.g. Turkish `İ`/`i`, Swedish `ä` ordering).
Two machines with different locales can order goals/agents and match searches
differently.

Proposed fix: use a fixed `Intl.Collator("en", { sensitivity: "variant" })`
(shared constant) for display ordering, or compare code units. Use
`toLowerCase()` rather than `toLocaleLowerCase()` for search normalisation,
with an ASCII-only fold if Turkish-locale safety is wanted.

### L2. `hostFor` picks the most degraded host and has no instance tie-break

`src/projection/projection.ts:59-65`.

Why it matters: with several hosts, one unavailable host becomes
`projection.host` even when another is live; two hosts of the same kind/status
are ordered by their position in the persisted array rather than
`hostInstanceId`. Whether "worst host wins" is intended is not documented; the
renderer displays this as the single host status.

Proposed fix: decide the display policy explicitly (e.g. prefer live, then
stale, then unavailable; or aggregate). Add `hostInstanceId` as the final
tie-break and a unit test with mixed statuses.

### L3. Host attention items collide by `hostKind` across host instances

`src/attention/attention.ts:276-296`.

Why it matters: items are keyed by `${host.hostKind}:host-unavailable`, then
`composeAttention` groups by `targetType:targetId`. Two unavailable instances
of the same kind collapse into one subject whose `id` duplicates in
`supportingSignals`, and counts under-report the number of affected hosts.

Proposed fix: key by `${hostKind}:${hostInstanceId}` for the item id and add
`hostInstanceId` to `targetId` (or add an explicit host-instance field). Add a
test with two same-kind hosts in different states; the attention tests
currently never pass `hosts` at all.

### L4. `projectRelatedAgents` has a dead `includeArchived` parameter

> Validation note (2026-09-11): **false positive.** The fourth parameter is
> `includeDismissed`, not `includeArchived`, and it is read at
> `projection.ts:553` to hide dismissed candidates by default. No change made.

`src/projection/projection.ts:375-390`: the parameter is accepted but never
true from `createProjectionModule` (`projection.ts:973-974`), and the internal
`projectCommandCentre(state, now)` call at line 390 never forwards it.

Why it matters: dead API surface that implies archived-unresolved agents are
representable in related-agent results when they are not (unlike command
centre/inspector, which do retain them).

Proposed fix: remove the parameter, or forward it and add the corresponding
candidate tests.

## Test coverage gaps

The existing tests are strong on the uncertainty/attention policy paths but
miss the failure modes above. Concretely missing:

- `positions.test.ts`: >120 satellites/inbox ids; insertion of an id that
  sorts before existing ids; `initialGoalMapPosition` with enough goals to
  exhaust candidates; `goalLayoutFootprint(NaN/negative)`; `mapInboxAnchor([])`.
- `viewport.test.ts`: `panViewport` from a centre beyond ±500; NaN/Infinity
  points; negative/zero bounds and scale; `zoomViewportAt` when `state.zoom`
  is 0; extremely large point arrays.
- `attention.test.ts`: the `hosts` branch (`unavailable`, multiple
  instances); `composeAttention` with multiple claims on one subject
  (`supportingSignals` is never asserted); `formatAge` boundaries
  (59s/60s/24h/negative/NaN); priority fallback when the Goal is missing.
- `projection.test.ts`: empty inspector branches (`Goal/Agent no longer
exists`); empty/whitespace search; `includeArchived` attention counts;
  `hostFor` with mixed host statuses; `projectRelatedAgents` unknown goal and
  dismissed-inclusion counts from the projection side.
- No static boundary test asserts `projection/`, `attention/` and `spatial/`
  stay free of `persistence/`, Effect and concrete host imports. The existing
  `web/src/api/browser-boundary.test.ts:5-20` only checks `web/src`. Add a
  small source-scan test for the derived-view modules (they currently pass, but
  nothing stops a future import).

## Verified clean

- Purity: `projection.ts`, `types.ts`, `attention.ts`, `positions.ts` and
  `viewport.ts` have no runtime imports of persistence, `Effect`, or concrete
  host adapters. `attention.ts:9` imports `displayHostKind` from
  `hosts/types.ts`; that module has only type imports otherwise, so this is
  host-contract formatting rather than host behaviour, but it is the one
  derived-view → hosts dependency worth keeping an eye on.
- Default (non-archived) uncertainty handling is careful: stale blocked/waiting
  states stay Monitor (`attention.ts:180-204`), `ended-externally` is paired
  with a fresh complete observation by Universe construction, and
  `publicAgent` strips execution history, locators and provider references
  (`projection.ts:86-111`).
- `mapFromCommandCentre` reuses the command-centre view rather than rebuilding
  it (asserted at `projection.test.ts:31-51`), and code-context/map layouts are
  recomputed deterministically from stable keys.

## Validation pass and resolution (2026-09-11)

Re-checked every finding against the source before changing anything. Result:
17 confirmed, 1 false positive (L4), 3 product decisions taken with the
operator. All confirmed items are resolved in the same change:

| Finding | Verdict / resolution                                                                                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1      | Confirmed with the real functions (first duplicate at goal 289 with 0 agents, goal 81 at 10 agents). Fixed with a finitely bounded coarse lattice fallback in `positions.ts`; 2,000 goals now produce 2,000 unique placements and a new uniqueness test covers 200.                                           |
| H2      | Confirmed (300 requested ids previously yielded 120 slots). Offsets are generated lazily to the requested count; 300-agent satellite/inbox tests added.                                                                                                                                                       |
| H3      | Confirmed. Cost fixed by single-pass goal indexing (measured 30k agents: 473 ms → 20 ms; 50k: 559 ms → 28 ms). Payload fixed with `maximumAgents`/`maximumTransitions`, `truncated`/`omitted*` fields, and publisher budget-halving fallback instead of a 503; publisher test injects an oversized portfolio. |
| H4      | Confirmed, but the module was unused. Decision: delete `src/spatial/viewport.ts` and its test; the shipped atlas camera is separately tested.                                                                                                                                                                 |
| H5      | Confirmed (both input orders previously produced input order). Replaced with a rank map; test asserts both orderings converge.                                                                                                                                                                                |
| M1      | Confirmed (append of `agent-10` previously moved four existing satellites). Fixed by natural-identity ordering; regression test covers the decimal boundary. Note: inserting an id that sorts before incumbents can still reflow (collision-free derived layout); the doc comment only promises no collapse.  |
| M2/M8   | Confirmed, but in the deleted viewport module. Resolved by deletion; the remaining `Math.min(...)` spread in `mapInboxAnchor` was replaced with a loop.                                                                                                                                                       |
| M3      | Confirmed. Resolved by deletion (decision above).                                                                                                                                                                                                                                                             |
| M4      | Confirmed against `AGENTS.md`: strip `nativeId`/`executionContainer` from `AgentView`, schemas and the inspector (decision above). Related-agent evidence now reads raw Agent records internally; white-box test asserts no leak.                                                                             |
| M5      | Confirmed with a probe (`includeArchived` produced human attention for archived+absent Agents). `ended-externally` is now gated on `archivedAt === undefined`; attention test added.                                                                                                                          |
| M6      | Confirmed. Search query now takes `limit`; the API passes 50 and the unused `now` was dropped; test asserts the bound.                                                                                                                                                                                        |
| M7      | Confirmed. `changesAfter` now walks from the tail; catch-up truncation keeps the oldest unread so an acknowledgement can never skip unread transitions.                                                                                                                                                       |
| M9      | Confirmed. `\\` UNC values are rejected; test added.                                                                                                                                                                                                                                                          |
| L1      | Confirmed as environment-sensitive. Replaced with an explicit `Intl.Collator("en")` in `projection.ts` and `toLowerCase()` for search.                                                                                                                                                                        |
| L2      | Confirmed ambiguity. Kept "most degraded host" policy, added `hostInstanceId` tie-break and a mixed-host test.                                                                                                                                                                                                |
| L3      | Confirmed. Host attention ids/targets now include `hostInstanceId`; test with two unavailable instances added.                                                                                                                                                                                                |
| L4      | **False positive** — parameter is `includeDismissed` and is used. No change.                                                                                                                                                                                                                                  |

Verification: `bun run format`, `bun run check`, and `bun test` (391 pass, 0
fail across 56 files) all pass after the change.
