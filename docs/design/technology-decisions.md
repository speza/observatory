# AO technology decisions

Status: accepted for v0 implementation  
Date: 2026-08-21  
Depends on: [AO technical architecture](technical-architecture.md)

## Decision

AO v1 will use TypeScript on Bun for the control plane, command-line client,
adapters and initial renderers.

```text
Language                  TypeScript
Runtime/package manager   Bun
Persistence               SQLite via bun:sqlite
Linting                   Oxlint
Formatting                Oxfmt
Type checking             tsgo or tsc --noEmit
Testing                   bun test
Terminal renderer         OpenTUI, portable spatial cells
Web renderer              Browser Canvas/WebGL, deferred until after live TUI proof
Live session host         Herdr
Local transport           Schema-validated JSON over a Unix socket
```

This is a v1 product-development decision, not a commitment to implement a
future native terminal multiplexer in TypeScript.

## Why this stack fits AO

AO's initial implementation is primarily:

- a durable metadata and relationship model;
- deterministic graph projections and attention rules;
- local SQLite persistence;
- JSON communication with Herdr and agent integrations;
- a live Herdr walking slice; and
- a portable terminal command centre.

It does not initially own pseudo-terminals, terminal emulation, process
persistence or remote attachment. Those responsibilities remain behind the
Session-host seam.

TypeScript therefore optimises the work carrying the most product uncertainty.
The same domain types and fixtures can support the terminal client, later local
web client, control plane and CLI. This shortens the loop between changing the
information model and seeing whether AO improves real supervision.

## Runtime: Bun

Bun is both the application runtime and package manager.

Reasons:

- native TypeScript execution;
- built-in SQLite support;
- built-in test runner;
- fast startup and feedback loops;
- straightforward subprocess and filesystem integration;
- standalone executable compilation; and
- direct compatibility with OpenTUI's primary TypeScript setup.

Relevant documentation:

- [Bun SQLite](https://bun.sh/docs/runtime/sqlite)
- [Bun SQL](https://bun.sh/docs/runtime/sql)
- [Bun standalone executables](https://bun.sh/docs/bundler/executables)

Bun does not define AO's module interfaces. The Universe module must remain
ordinary TypeScript with injected persistence, clock and identifier
implementations. Bun-specific imports belong in adapters and executable entry
points.

### SQLite usage

Use `bun:sqlite` directly rather than introducing an ORM in v1.

The control plane owns a single write path, making SQLite's synchronous interface
appropriate and simple. Transactions protect domain commands. WAL mode may be
enabled when separate long-lived readers appear, but should not compensate for
renderers bypassing the control plane.

Database rows are an implementation detail of the persistence adapter. Domain
records and projections must not become generated database models.

## Toolchain: Oxc

Oxc is the default JavaScript and TypeScript toolchain around the Bun runtime.
It is not AO's runtime.

Use:

- Oxlint for linting;
- Oxfmt for formatting; and
- Oxc's shared tooling indirectly where adopted by the build ecosystem.

Do not initially use:

- the Oxc parser directly;
- the Oxc transformer directly;
- the Oxc resolver directly;
- the Oxc minifier directly; or
- the experimental TypeScript runner.

Bun already executes the application, and the web toolchain already owns
browser transformation and bundling. Directly composing Oxc internals would add
tooling work without validating AO.

Oxfmt is currently described as beta. AO is greenfield, so formatter migration
compatibility is not a concern, but the version must be pinned and upgrades must
be deliberate.

Relevant documentation:

- [Oxc](https://oxc.rs/)
- [Oxlint](https://oxc.rs/docs/guide/usage/linter.html)
- [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html)

### Type checking remains separate

Linting does not establish that AO type-checks. CI and the local quality command
must run a dedicated TypeScript checker.

The initial choice between `tsgo` and `tsc --noEmit` should be based on
compatibility with the selected TypeScript configuration. This decision does not
affect application architecture.

## Presentation strategy

The rendering spikes resolved the v0 presentation decision:

- the native terminal client is a restrained, keyboard-first spatial universe;
- OpenTUI is accepted for that portable cell-based map and its supporting
  lenses;
- high-fidelity terminal graphics, Kitty/Sixel modes and custom ANSI raster
  rendering are out of v0 scope; and
- a later local browser client may provide higher-fidelity canvas observatory
  rendering.

The terminal and web clients consume the same semantic projections and expose
the same authorised actions. They do not need to reproduce identical geometry
or visual effects. The terminal optimises attention, comprehension, search and
fast attachment. The web client may optimise spatial overview, animation,
pointer interaction and richer relationship exploration.

The browser renderer remains deferred as a fidelity expansion until the live
native spatial slice proves the goal, attention and spatial-memory model with
real sessions. It will be an ordinary local web
client served by AO, not an Electron application.

## Terminal renderer: OpenTUI

OpenTUI is accepted for the v0 terminal client. Its native core is written in
Zig and exposed to TypeScript; it supports the input, resize, alternate-screen,
colour and portable cell rendering needed for the command centre.

Relevant documentation:

- [OpenTUI getting started](https://opentui.com/docs/getting-started/)
- [OpenTUI renderer](https://opentui.com/docs/core-concepts/renderer/)
- [OpenTUI framebuffer](https://opentui.com/docs/components/frame-buffer/)
- [OpenTUI repository](https://github.com/anomalyco/opentui)

Use the imperative `@opentui/core` interface. React and Solid reconcilers add
another programming model without providing leverage for this client.

OpenTUI is intentionally isolated inside the terminal-renderer module. Its
constructs, layout model and event types must not appear in Universe, Attention,
Layout, Projection or host-adapter module interfaces. AO owns the semantic
projection and logical layout; OpenTUI only turns them into terminal output and
input events.

### POC outcome and limits

The disposable rendering and visual-fidelity spikes proved that OpenTUI can
sustain portable spatial rendering, navigation, resize and clean terminal
lifecycle behaviour. The first live map iteration now tests whether that
spatial representation is preferable to a strong operational view. Enhanced
terminal graphics and the half-block raster direction remain rejected because
they create compatibility and custom-renderer complexity without providing the
flexibility of a real canvas.

Therefore v0 uses ordinary terminal cells, typography, colour and restrained
motion for a spatial universe of goal bodies and direct session satellites. It
does not emit graphics protocols or revive a custom ANSI raster engine. OpenTUI
remains isolated inside the terminal-renderer module, so it can still be
replaced if live use exposes input, lifecycle or portability failures.

The live renderer keeps the map full width rather than allocating a permanent
right-hand inspector. Selecting a goal, session or inbox opens a transient
floating card anchored near that item; the card is clamped to the map and
shortens on narrow terminals. Unassigned sessions are connected to the neutral
inbox by ordinary cell tethers, with a compact inbox panel used only when the
80x24 portfolio cannot give the orbit enough room. These are presentation
lenses over Goal → Session state, not new domain nodes or a richer graphics
mode.

Evidence:

- [OpenTUI rendering spike](../../prototypes/opentui-rendering-spike/VERDICT.md)
- [Native visual-fidelity spike](../../prototypes/opentui-visual-fidelity/VERDICT.md)
- [ANSI half-block spike](../../prototypes/ansi-halfblock-rendering-spike/VERDICT.md)

## Live session integration: Herdr first

Herdr is the first live Session-host adapter because it already exposes
snapshots, events, agent state, worktree provenance and attachment operations
across several agent providers.

AO talks to Herdr through its public local protocol. It does not embed, fork or
import Herdr implementation code.

This maintains a clean licensing and module seam while ensuring Herdr-specific
workspace, tab and pane concepts do not leak into AO records.

Relevant documentation:

- [Herdr documentation](https://herdr.dev/docs/)
- [Herdr socket interface](https://herdr.dev/docs/socket-api/)

## Local control transport

The production control plane should expose schema-validated JSON over a Unix
domain socket on macOS and Linux.

Reasons:

- local-only by default;
- straightforward CLI and agent access;
- streaming events without polling the database;
- filesystem permissions for single-user access; and
- independence from renderer and adapter runtimes.

The v0 in-process walking slice does not implement this transport. A later
browser client can use a loopback HTTP/WebSocket adapter translating the same
command, query and subscription interface.

External input must be validated at runtime. TypeScript compile-time types do
not validate socket messages, adapter payloads, database migrations or agent
commands.

## Proposed source layout

Do not create a package for every named module on day one. Start with one Bun
workspace and keep module interfaces explicit inside it.

```text
src/
├── universe/
├── attention/
├── projection/
├── layout/
├── search/
├── control/
├── persistence/
│   └── sqlite/
├── hosts/
│   └── herdr/
├── providers/
├── git/
└── cli/

clients/
├── tui/
└── web/                 # deferred

fixtures/
└── herdr/
```

Split independently deployed clients or reusable protocol types into workspace
packages only when a second consumer creates a real seam. Avoid a monorepo of
shallow pass-through packages.

## Initial quality commands

The repository should converge on a small interface for humans, agents and CI:

```sh
bun run check       # format check, lint and type check
bun run test        # deterministic tests
bun run test:all    # tests plus slower adapter and fixture checks
bun run dev         # live terminal command centre
bun run test:herdr  # Herdr adapter contract and sanitised fixture checks
```

The exact underlying flags belong in scripts rather than agent instructions.
Agents should learn the stable project commands, not the current tool invocation
details.

## Dependency policy

- Prefer platform functionality supplied by Bun before adding wrappers.
- Keep the Universe module free of Bun, SQLite, OpenTUI and Herdr imports.
- Pin fast-moving dependencies, particularly OpenTUI and Oxfmt.
- Upgrade intentionally with domain, adapter and renderer fixtures.
- Avoid an ORM until repeated persistence complexity demonstrates that direct
  SQL is harming locality.
- Avoid a graph database; AO's semantic graph is small and SQLite can represent
  typed nodes and edges directly.
- Avoid a general agent framework; integrations call the control interface
  through ordinary CLI commands or structured messages.

## Alternatives considered

### Rust

Rust is the preferred technology for a future AO-native multiplexer, but not for
the v1 semantic control plane.

Advantages:

- strong fit for pseudo-terminals, process control and terminal protocols;
- mature Ratatui ecosystem;
- robust single-binary distribution;
- excellent concurrency and resource control; and
- mature SQLite integration through `rusqlite`.

Costs now:

- slower product iteration while the information model is uncertain;
- separate implementation from the later browser client;
- more type and protocol duplication across clients; and
- systems complexity before AO owns systems responsibilities.

Relevant documentation:

- [Ratatui](https://ratatui.rs/)
- [rusqlite](https://docs.rs/rusqlite/latest/rusqlite/)

### Go

Go with Bubble Tea is a strong conventional terminal stack and a credible
single-binary alternative.

Advantages:

- mature, production-tested TUI framework;
- easy concurrency and distribution; and
- faster implementation than Rust for many developers.

Costs for AO:

- little sharing with the later browser client;
- no decisive advantage for the metadata control plane; and
- no measured advantage over the accepted TypeScript and OpenTUI v0 stack.

Relevant documentation:

- [Bubble Tea](https://github.com/charmbracelet/bubbletea)

### Node.js instead of Bun

Node.js is viable but not preferred for v1. Bun reduces tool count through
native TypeScript, SQLite, testing and executable compilation. AO should not rely
on Bun-specific behaviour inside its domain modules, preserving a migration path
if Bun becomes a constraint.

## Triggers to reconsider TypeScript/Bun

Reconsider the application runtime when evidence shows one of these conditions:

- AO must own pseudo-terminals or terminal emulation;
- an AO-native multiplexer becomes near-term scope;
- OpenTUI cannot meet rendering or input requirements;
- Bun executable distribution is unreliable on target systems;
- required host inspection needs extensive native code;
- daemon memory, latency or crash behaviour is unacceptable in measured use; or
- the JavaScript native-extension surface becomes the dominant maintenance cost.

The first response should be a native adapter behind an existing seam, not an
automatic whole-system rewrite.

## Versioning policy

- Commit the Bun lockfile.
- Pin OpenTUI and Oxfmt exactly during v0.
- Pin the Oxc command packages to compatible versions.
- Record the minimum Bun version in the repository.
- Let automated dependency updates open proposals, but merge only after the
  domain, adapter, quality and renderer checks pass.
- Do not depend on unpublished internals from Herdr, OpenTUI or Oxc.

## Consequences

Positive:

- One language across the riskiest product experiments.
- Fast local and agent feedback loops.
- Minimal database and build infrastructure.
- Renderer and host technologies remain replaceable.
- Rust remains available exactly where it would provide real leverage.

Negative:

- Bun and OpenTUI are younger than Node.js, Rust/Ratatui or Go/Bubble Tea.
- OpenTUI introduces a native Zig dependency beneath the TypeScript client.
- A future native multiplexer will probably add a second language.
- Runtime validation discipline is essential because TypeScript types disappear
  at external seams.

Accepted trade-off:

> AO should optimise learning about the product before optimising ownership of
> terminal infrastructure it may never need to build.
