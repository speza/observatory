# Observatory agent instructions

## Product constraints

- Observatory is an agent observatory: a local semantic control plane for
  supervising agent sessions. `AO` remains its internal codename and command/
  environment-variable prefix. It is not an agent runtime or terminal
  multiplexer.
- The spatial universe is the primary product hypothesis. Lists, attention
  queues, inboxes and inspectors are supporting lenses.
- V1's durable topology is `Goal -> Session`. Repositories, worktrees and Herdr
  spaces are session metadata, not organisational nodes.
- Goal priority, completion and archive remain human-controlled unless an
  explicit auto policy says otherwise.
- Preserve uncertainty. Never convert missing, stale or inferred host facts
  into accepted semantic state.

## Architecture

```text
SessionHost -> HostSnapshot -> Universe -> UniverseStore
                                  |
                                  v
                             Projections -> Renderer
```

- `universe/` owns the model, commands, invariants and host reconciliation. It
  is the only writer of trusted Observatory state.
- `hosts/` translates external session hosts; `persistence/` stores Universe
  state; `attention/`, `spatial/` and `projection/` derive deterministic views;
  `renderer/` owns presentation and input only.
- Renderers consume projections and submit commands. They do not access SQLite
  or concrete host adapters; explicit attach/terminal actions go through the
  injected generic `SessionHost` capability port.
- Keep host-specific behaviour behind the `SessionHost` seam. Herdr identifiers
  and attachment targets remain opaque outside its adapter.
- Herdr is the deliberate required live host for V0/V1. That is a product
  dependency, not a control-plane dependency: Herdr protocol types, command
  names, native identifiers and lifecycle rules must not enter `universe/`,
  `persistence/`, `attention/`, `spatial/`, `projection/` or renderer
  interfaces.
- `SessionHost` is the only host seam. The composition root selects a concrete
  adapter; `hosts/herdr/` owns all Herdr translation and process/terminal
  mechanics. Do not add a second `HerdrService`-style pass-through seam or
  expose Herdr workspaces, tabs or panes as domain concepts.
- Keep the generic seam small and capability-based. Unsupported host
  operations must be explicit; do not add speculative methods or a universal
  provider/terminal API to anticipate every future host.
- A future tmux adapter, Superlogical-style host, or Observatory-owned
  multiplexer must be replaceable at composition time without changes to the
  Universe, persistence, projection or renderer modules. If adding a host
  requires those changes, repair the seam before adding host-specific logic.
- Every production adapter must have the shared `SessionHost` contract tests,
  sanitised fixtures and a live smoke path where available. Core tests must run
  without Herdr; the mock host is the deterministic evidence path.
- Persist durable semantic state and accepted goal positions. Keep viewport,
  hover, selection and other transient presentation state in the renderer.
- Prefer deep modules with small interfaces. Do not add pass-through layers or
  speculative seams.
- Before changing product invariants or module interfaces, read the relevant
  files under `docs/design/` and update them with the implementation.

## Scope and evidence

- Do not add a daemon, web UI, native multiplexer, workstream layer, transcript
  ingestion or terminal graphics protocol without an explicit product decision.
- Prototypes are disposable evidence, not production dependencies. Do not
  revive the rejected ANSI rendering direction.
- Never commit real session transcripts, credentials or private host data.
  Fixtures must be synthetic or sanitised.
- Exercise host behaviour through `SessionHost`; use the mock adapter for
  deterministic coverage. For renderer changes, also dogfood `bun run dev:mock`.

## Quality

- After changing supported source, configuration or documentation, run
  `bun run format`.
- Before committing or handing work back, run `bun run check` and `bun test`.
- Do not weaken a lint rule merely to clear a finding. Fix the defect, or
  document why the rule is a poor fit before changing shared configuration.
- Use trunk-based development: work directly on `main` until the user says
  otherwise. Do not create feature branches or pull requests by default.
- Do not commit or push unless the user asks.
