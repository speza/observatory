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
  or hosts directly.
- Keep host-specific behaviour behind the `SessionHost` seam. Herdr identifiers
  and attachment targets remain opaque outside its adapter.
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
- Do not commit or push unless the user asks.
