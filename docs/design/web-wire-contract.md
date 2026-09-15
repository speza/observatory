# Web wire contract

**Status:** Implemented on `main`. Decisions resolved as recommended: D1 — the contract
owns its priority vocabulary and imports nothing from the domain; D2 — harness descriptors
are mirrored by the contract's launch-option schema; D3 — renderer tests keep the universe
test-support and mock-host fixture carve-out, scoped to test files. Enforcement: oxlint
`no-restricted-imports` overrides in `.oxlintrc.json`, wired into `bun run check`.

## Purpose

Make the browser↔server wire contract a real boundary instead of the current
compile-time illusion, without adding new tooling, dependencies, or a
language-neutral schema pipeline.

The contract existed in four hand-maintained places that had to be kept in sync
by hand. This spec consolidates them into one server-owned vocabulary
from which both sides derive their types, enforced by compile-time checks and
lint rules. It does not change any wire format, endpoint, or behavior.

## State before the separation (evidence)

The wire contract was stated four times, none of them authoritative:

1. **`src/web/protocol.ts`** — 34 exported types. Nominally the contract, but it
   imports type families from ten internal modules (`universe/`, `hosts/`,
   `plugin-sdk/`, `workspaces/`, `session-launch/`, `agent-closeout/`,
   `repositories/`, `plugins/`, `conversations/`, plus `./portfolio.ts`). The
   browser therefore compiles against the server's internals. Several exports
   are pure aliases (`WebAgentRepositoryStatusResponse =
AgentRepositoryStatusSnapshot`), so internal shape changes silently change
   the wire.
2. **`src/web/commands.ts`, `src/web/api.ts`, `src/web/launch.ts`,
   `src/web/closeout.ts`, `src/web/terminal.ts`** — hand-written Effect Schemas
   for what the server _receives_ (commands, closeout, launch, terminal and
   admit requests). Already the right mechanism, but duplicated literals and
   separated from the type vocabulary.
3. **`web/src/api/schemas.ts`** (619 lines) — a complete hand-written Effect
   Schema mirror of what the browser _receives_: the entire portfolio, SSE
   event, inspector and search contract, plus command and start-agent
   responses. It re-declares — by hand — shapes whose source of truth is
   `src/projection/types.ts`. The file is deleted; its schemas moved into the
   contract.
4. **`web/src/api/client.ts`** — a further set of local schemas (launch options,
   workspace browser, terminal links, conversation history, add/admit
   responses), also hand-maintained; moved into the contract and derived.

Concrete duplication: the priority vocabulary (`P0`–`P3`) is independently
declared in `src/universe/types.ts`, `src/web/commands.ts`,
`web/src/api/schemas.ts`, `web/src/goals/NewGoalDialog.tsx` and
`web/src/inspector/Inspector.tsx`. `UniverseChange` is declared three times
(universe types, browser schemas, and consumed directly by
`web/src/attention/CatchUpPanel.tsx`, which bypasses the projection lens).

Four renderer files import `src/universe/types.ts` directly in production code
(`App.tsx`, `Inspector.tsx`, `NewGoalDialog.tsx`, `CatchUpPanel.tsx`), leaking
domain internals past the documented projection boundary. `web/src` also
imports `src/universe/test-support.ts` in tests.

## Problem statement

A boundary that re-exports internals provides no information hiding: none of
separation's benefits, plus the illusion of one. Every projection or domain
shape change must be manually replicated into the browser schema file; drift is
caught only by tests, not by construction. The same coupling is what makes any
future server replacement expensive: today a second server implementation would
need to satisfy the domain's internal types, not a contract.

## Goals

- One owned wire vocabulary. Both sides derive compile-time types from it.
- The browser compiles against the contract and the projection types only.
- Drift between the contract and domain types is a compile error, not a
  browser runtime failure.
- Enforcement via existing tooling (oxlint); no new dependencies.
- No wire-format, endpoint or behavior change at any phase.

## Non-goals

- No codegen or language-neutral schema pipeline. That machinery is justified
  only when a second implementation of the contract appears (a Go server, an
  external API consumer, a non-Effect renderer). This spec records the trigger
  condition, not the machinery.
- No API versioning. Observatory is a lockstep-deployed local product with no
  external consumers.
- No changes to `universe/`, `persistence/`, `attention/`, `spatial/`,
  `projection/` computation, hosts, or `SessionHost`. The projection module
  stays Effect-free and untouched; the contract layer composes its types.
- No second `SessionHost`-style pass-through seam. This work tightens an
  existing documented seam (`renderer → web gateways`), it does not add one.

## Target design

### Module layout

```text
src/web/protocol/        ← THE wire contract (server-owned, Effect Schema)
  index.ts               ← public surface: schemas + derived types
  commands.ts            ← WebCommand union + request/response schemas (write path)
  views.ts               ← portfolio, projection events, inspector, search
                           (read path; derives from src/projection/types)
  auxiliary.ts           ← launch, closeout, workspace review/browser,
                           repository status, plugin status, conversation history
  terminal.ts            ← terminal client/server messages, links, limits
  vocabulary.ts          ← shared wire vocabulary (priority union); kept in its
                           own module so commands.ts and views.ts do not form
                           a circular import
```

`src/web/protocol.ts` was replaced by the directory; import paths of existing
consumers changed mechanically. Split files further only when one outgrows
comfort.

### The three shape classes

Every wire shape belongs to exactly one class, with a fixed treatment:

| Class                                                                                                                                      | Source of truth                                        | Treatment                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Projection-typed** (portfolio, events, inspector, search)                                                                                | `src/projection/types.ts`                              | Schemas in `protocol/views.ts`; compile-time assignability assertions bind `Schema.Type<…>` ⇄ projection types. Browser schemas derive from these; nothing re-declares literals. |
| **Owned write/aux shapes** (commands, results, launch options, closeout, review, repository/plugin status, conversation history, terminal) | The contract itself                                    | Schemas declared in `protocol/`; gateways map domain types to contract shapes via explicitly typed functions.                                                                    |
| **Opaque handles** (terminal links, pending launches, discovery)                                                                           | Already narrow (`WebTerminalLink`, `WebPendingLaunch`) | Move into the contract unchanged; extend the opaque-handle pattern where internals leak.                                                                                         |

### Binding the contract to the domain

Two mechanisms, both compile-time:

1. **Inline assertions** (projection-typed shapes): each derived type is
   asserted mutually assignable with its projection counterpart in the
   protocol module. A projection change that breaks the wire fails the build
   in one file, at the boundary, instead of failing browser validation at
   runtime.
2. **Type-directed mapping** (auxiliary shapes): gateway functions are
   annotated with contract-derived return types
   (`AgentRepositoryStatusSnapshot → WebAgentRepositoryStatusResponse`). The
   gateway files — the only places permitted to import both sides — become the
   enforcement site; a shape change that breaks the contract fails the
   gateway's build.

Domain-internal types (`CommandResult`, `LinkedExecution`,
`AgentHarnessDescriptor`, workspace types, …) never appear in the contract
module. Where a value vocabulary is genuinely wire-level (priority, terminal
link kinds/sources, positions), the contract owns its own literal union and
the gateway maps.

### Dependency rules

```text
src/web/protocol/*  → src/projection/types.ts   (only)
web/src/**          → src/web/protocol/*, src/projection/types.ts,
                      web/src/**, node_modules   (only)
```

Everything else under `src/` is unreachable from the renderer. The gateway
modules (`api.ts`, `launch.ts`, `closeout.ts`, `terminal.ts`,
`projection-publisher.ts`) may import protocol, projection, and their
coordinator dependencies — they remain the only translation edge.

### Renderer leak resolution

- `DEFAULT_SYSTEM_ID`: becomes a protocol-owned constant (decision D1) so the
  renderer stops importing `universe/types.ts`.
- Priority pickers: the ordered priority list is exported from the contract
  and derived by `NewGoalDialog` and `Inspector` instead of hand-typed arrays.
- `CatchUpPanel`: switches from `UniverseChange` to the catch-up projection's
  own item type.
- `web/src/api/schemas.ts`: its shapes move to `src/web/protocol/` and derive
  from the contract schemas; the file is deleted. Tests follow the shapes.

### Enforcement

oxlint `no-restricted-imports` overrides (already wired into `bun run check`):

- `web/src/**`: restricted to the allow-list above; production violation of
  `src/universe`, `src/hosts`, `src/workspaces`, `src/session-launch`,
  `src/agent-closeout`, `src/repositories`, `src/plugins`,
  `src/conversations`, `src/plugin-sdk`, `src/persistence`, `src/attention`
  is a lint error.
- `src/web/protocol/**`: restricted to `src/projection/types.ts` plus `effect`.
- Test files: single documented carve-out for `src/universe/test-support.ts`
  pending decision D3.

## Phased plan

Each phase lands on `main` with `bun run check` and `bun test` green; renderer
phases are dogfooded via `bun run web:mock`. No wire-format or behavior
change in any phase.

### Phase 0 — Inventory and classification (half day)

Script the import graph in both directions; produce the classification table
(protocol exports → projection-typed / owned / mapped) and record the
dependency rules in `docs/design/technical-architecture.md`. **Accept:**
classification reviewed, rules agreed.

### Phase 1 — Own the write path (half day)

Move request schemas from `src/web/commands.ts` and `api.ts` into
`src/web/protocol/commands.ts`; `commands.ts` consumes them. Collapse the five
priority-literal declarations into the contract union. **Accept:** zero
behavioral diff; duplicate literals gone; `decodeWebCommand` unchanged.

### Phase 2 — Own the read and auxiliary shapes (bulk of the work)

- `PortfolioResponse`'s type moves into the contract; `src/web/portfolio.ts`
  imports it back (dependency inversion: the wire shape is owned by the
  contract, the server is held to it).
- `CommandResult` and the five feature-result families are mapped to
  contract-owned shapes; pure-alias exports (`WebAgentRepositoryStatusResponse`
  etc.) are deleted.
- `AgentHarnessDescriptor` is narrowed to a launch-options descriptor (decision
  D2); the browser no longer sees the plugin SDK.
- Browser schemas move into the contract and derive from it;
  `web/src/api/schemas.ts` is deleted. **Accept:** renderer compiles against
  contract + projection only; SSE/REST payloads byte-identical.

### Phase 3 — Close the renderer leaks (small)

`DEFAULT_SYSTEM_ID`, priority pickers, `CatchUpPanel` per the resolution
above; universe/types production imports reach zero. Dogfood
`bun run web:mock`. **Accept:** no `src/universe` import outside tests.

### Phase 4 — Enforce and document (small)

Add the oxlint overrides; finish the `technical-architecture.md` updates
(module ownership for `web/` and `web/src/`, dependency-rule section, testing
strategy note). **Accept:** `bun run check` fails on a deliberately
introduced violation; docs match the implementation.

## Risks and mitigations

- **Shape reconciliation is not mechanical.** Re-exports like
  `WorkspaceReviewSnapshot` hide fields the browser never reads. The browser
  schema file is the spec for each contract shape; differences surface as
  explicit decisions during Phase 2 mapping, not silent drift. Mitigation:
  classify in Phase 0, map one family per change, keep tests green.
- **Bundle size.** The renderer already ships Effect Schema
  (`web/src/api/schemas.ts` imports `effect` today), so consolidation adds no
  new dependency or class of code. Verify no tree-shaking regression in the
  web build during Phase 2.
- **Migration drift.** Contract types keep their existing names and shapes
  where correct; renames happen only where a type was an alias. SSE event and
  REST payloads are unchanged, so the epoch/revision fencing logic is
  untouched.
- **Pass-through concern.** `protocol/` is not a pass-through layer: it owns
  validation, bounds and browser-safe narrowing (the existing
  `WebTerminalLink` pattern generalized), and it is the seam that makes a
  future server implementation cheap.

## Decisions (resolved as recommended)

- **D1 — Priority vocabulary ownership.** Resolved: contract-owned. The
  contract declares its own priority vocabulary (`vocabulary.ts`) and imports
  nothing from `universe/`; the domain keeps its own equal tokens and gateways
  map between them.
- **D2 — Harness descriptors.** Resolved: the contract's launch-option schema
  mirrors the harness-descriptor fields the launch UI consumes, so the browser
  no longer sees the plugin SDK.
- **D3 — Test carve-out.** Resolved: renderer tests keep the universe
  test-support and mock-host fixtures, granted by a test-scoped lint override;
  production renderer code may not import them (the production rule admits the
  contract and projection types only). Tests additionally use
  `projectPortfolio` as a fixture for decoding exercises. Renderer-owned presentation
  logic that had drifted into domain modules (`review-summary.ts` →
  `web/src/shared/integrationSummary.ts`, age formatting →
  `web/src/shared/formatAge.ts`) moved home during enforcement.

## Future trigger (recorded, not built)

If a second implementation of this contract ever appears — a Go server, a
native shell speaking a different protocol, an external API consumer — the
preceding work is the precondition that makes the swap cheap: the contract is
already owned, already derived-from, and already enforced. At that point the
work is promoting the contract to generated schemas; the Universe,
persistence, projection and renderer modules do not change.
