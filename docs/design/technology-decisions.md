# Observatory technology decisions

Status: accepted for the web-only V1 product

Updated: 2026-09-01

Depends on: [Observatory technical architecture](technical-architecture.md)

## Decision

Observatory uses one maintained application client: a local React GUI served by
the Bun control-plane process.

```text
Language                  TypeScript
Runtime/package manager   Bun
Async runtime             Effect + @effect/platform-bun
Persistence               SQLite via bun:sqlite
Linting                   Oxlint + vendored Anti-Slop plugins
Formatting                Oxfmt
Type checking             tsc --noEmit
Testing                   bun test
Browser renderer          React with native SVG/CSS
Browser terminal          xterm.js over host-owned streams
Build/dev server          Vite
Live agent host           Herdr (required for V0/V1 live mode)
Current local transport   Loopback HTTP + SSE
```

The former OpenTUI client was retired on 2026-08-27. Its experiments remain
useful historical evidence, but OpenTUI is no longer an application dependency
or technology direction. A future CLI may launch the server, report status or
submit structured commands; it must not become a second interactive client.

This is a product-development decision, not a commitment to implement a native
multiplexer, daemon or desktop shell in TypeScript.

## Why this stack fits Observatory

The main implementation work is:

- a durable semantic and relationship model;
- deterministic projections, attention and spatial rules;
- local SQLite persistence;
- translation of host facts and capabilities;
- a high-density graphical supervision surface; and
- fast experimentation with evidence, review and interaction workflows.

TypeScript keeps the semantic contracts, HTTP protocol and React client close
while those product questions remain uncertain. Bun supplies TypeScript
execution, SQLite, tests and a compact server runtime. React, SVG and CSS offer
crisp text, accessible controls, pointer interaction, responsive composition
and browser-native iteration without a canvas scene graph or desktop wrapper.

Observatory does not own pseudo-terminal process lifetime, pane scrollback or
agent execution. Those responsibilities remain behind `SessionHost`; xterm.js
interprets the host's terminal bytes but does not become the PTY owner.

## Runtime and module boundaries

Bun is the application runtime and package manager. Bun-specific imports belong
in adapters, persistence and executable composition roots. The Universe remains
ordinary TypeScript with injected store, clock and identifier implementations.

Effect is used at the asynchronous host/runtime edge:

- `SessionHost` operations return typed Effects;
- host terminal output is an Effect Stream; and
- the server composition root executes and finalises those resources.

Effect values do not cross into `universe/`, SQLite records, projections or
spatial calculations. It is a lifecycle tool, not a second domain model.

Use `bun:sqlite` directly rather than adding an ORM. The Universe owns one
transactional write path, database rows remain adapter details, and browser code
never reads the database.

## Browser presentation

React with native SVG and CSS is the accepted renderer.

- SVG owns the Atlas geometry, labels and stable logical transforms.
- HTML/CSS owns drawers, forms, inspectors, review and accessibility.
- xterm.js owns browser terminal interpretation and input presentation.
- Vite owns browser transformation, development serving and production builds.

PixiJS was rejected after direct pan/zoom comparison because rasterised text and
scene scaling reduced clarity without solving a product requirement. Electron
is deferred because the current local browser process already provides the GUI;
add a desktop shell only for a measured packaging or OS-integration need.

The Carbon Survey visual language is an art direction over production
projections, not a fixture tree or a second semantic model. Neutral carbon and
bone tones own structure, green denotes healthy working state, and vermilion is
reserved for attention and intervention. Its world-anchored logical grid pans
and scales with the Atlas, and dragged Goals snap to the same visible grid
intersections. Atlas, Ledger, Attention, Catch up, Inbox and Closeout remain
complementary lenses over the same accepted state.

## Host and terminal integration

Herdr is the first live `SessionHost` because it already exposes agent
inventory, state, worktree provenance, launch, close and terminal operations.
Only `src/hosts/herdr/` and composition code may know Herdr protocols or native
identifiers.

The browser asks the loopback server to open an accepted Agent. The server:

1. re-resolves generic `AgentAccess` through `SessionHost`;
2. opens a host-owned terminal with bounded dimensions;
3. emits frames over SSE using a random process-local handle;
4. accepts same-origin input, resize, scroll and release actions; and
5. releases all sessions on shutdown.

xterm.js renders those frames in the browser. It does not persist terminal
history, create a PTY or receive a concrete Herdr target. Linked executions use
the same capability and remain transient tabs, not Universe objects.

The replacement test remains strict: a future tmux or other host adapter must
not require changes to Universe, persistence, projection or browser interfaces.

## Local transport

The current product is one in-process, single-user application:

```text
Browser -> 127.0.0.1 HTTP/SSE -> Universe + SessionHost + SQLite
```

Mutation endpoints require exact loopback Origin, JSON content type and an
explicit intent header. The browser receives narrow projections and operation
results, never SQLite records, arbitrary filesystem paths or the internal
command union.

Polling is sufficient for snapshot reconciliation in this walking slice. A
versioned Unix-socket or subscription transport is deferred until concurrent
clients or external agent processes create a measured need. Do not introduce a
daemon merely because the architecture could support one.

## Toolchain and quality

Oxfmt owns formatting. Oxlint, selected type-aware checks and the vendored
Anti-Slop plugins own likely defects and boundary policy. A separate TypeScript
check remains mandatory. Disposable top-level prototype trees are excluded;
maintained source and documentation are not.

Stable commands are:

```sh
bun run format
bun run check
bun test
bun run build:web
```

Versions are pinned where rapid tool evolution could make builds
non-reproducible. Commit the Bun lockfile and upgrade deliberately after the
domain, adapter, API and browser checks pass.

## Source layout

```text
src/
├── universe/            # accepted semantic state and commands
├── attention/           # deterministic attention rules
├── projection/          # renderer-facing read models
├── spatial/             # pure logical positions and viewport math
├── runtime/             # shared composition
├── web/                 # loopback API and application entry point
├── persistence/sqlite/  # durable implementation detail
├── hosts/herdr/         # concrete live-host translation
├── hosts/mock/          # deterministic evidence path
├── session-launch/      # workspace/host launch coordination
└── workspaces/          # bounded local workspace capabilities

web/src/                 # React, SVG, CSS and xterm.js client
prototypes/              # isolated historical evidence only
```

Do not create packages or pass-through layers before a second deployment unit
or consumer creates a real seam.

## Alternatives and reconsideration triggers

Node.js remains viable, but Bun currently reduces tool and integration count.
Rust would be the preferred candidate if Observatory later owns PTYs, terminal
emulation, a multiplexer or a demanding always-on daemon. Go remains a credible
single-binary alternative, but offers no current advantage for this semantic
control plane and browser client.

Reconsider TypeScript/Bun when measured evidence shows that:

- Observatory must own process or PTY lifetime;
- a native multiplexer becomes near-term scope;
- Bun distribution, memory, latency or crash behaviour is unacceptable;
- required host inspection becomes predominantly native code; or
- browser delivery cannot meet a concrete product requirement.

The first response should usually be a native adapter behind an existing seam,
not a whole-system rewrite.

## Consequences

Positive:

- one maintained GUI and one interaction model;
- one language across the riskiest product surfaces;
- strong density, review and accessibility primitives;
- minimal database and server infrastructure; and
- replaceable host and persistence technologies.

Negative:

- browser terminal behaviour still depends on a streaming host capability;
- runtime validation remains essential at every external seam;
- Bun and parts of the tooling are younger than conservative alternatives; and
- a future native runtime could add a second language.

Accepted trade-off:

> Optimise learning about supervision, trust and spatial orientation before
> owning terminal infrastructure or maintaining a second client.
