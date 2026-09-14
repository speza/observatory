# Observatory technology decisions

Status: accepted for the maintained web renderer; macOS desktop delivery evaluation in progress

Updated: 2026-09-13

Depends on: [Observatory technical architecture](technical-architecture.md)

## Decision

Observatory uses one maintained application renderer: a local React GUI served
by the Bun control-plane process. The GUI currently runs in a normal browser. A
small AppKit/WKWebView shell is the leading macOS packaging candidate, subject
to the performance, lifecycle and distribution gates below; this is not yet an
adoption decision.

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
Live agent host           Herdr (required for live mode)
Current local transport   Loopback HTTP + SSE + WebSocket terminals
```

The former OpenTUI client was retired on 2026-08-27. Its experiments remain
as written historical evidence; their executables and package configurations
have been removed. OpenTUI is no longer an application dependency or technology
direction. A future CLI may launch the server, report status or
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
scene scaling reduced clarity without solving a product requirement. A desktop
shell is now justified as a packaging and macOS-integration experiment. The
leading candidate is a small AppKit application containing WKWebView and
supervising the existing Bun process. Electron remains a fallback if measured
WebKit compatibility, terminal or rendering behaviour is unacceptable; its
bundled Chromium runtime would trade a larger and less native distribution for
more predictable cross-platform browser behaviour and a mature desktop tooling
ecosystem.

The Carbon Survey visual language is an art direction over production
projections, not a fixture tree or a second semantic model. Neutral carbon and
bone tones own structure, green denotes healthy working state, and vermilion is
reserved for attention and intervention. Its world-anchored logical grid pans
and scales with the Atlas, and dragged Goals snap to the same visible grid
intersections. Atlas, Ledger, Needs you, Catch up and Inbox remain
complementary lenses over the same accepted state; result and lifecycle actions
converge in the Inspector.

## Native desktop delivery evaluation

The renderer technology is not itself the product differentiation. Observatory's
valuable distinction is the quality of spatial supervision, truthful
`System -> Goal -> Agent` semantics, attention handling, evidence and terminal
workflows. A lower-level renderer is useful only when operators receive a
measurably better experience from it.

The disposable GPUI and WKWebView experiments are retained on the
`spike/gpui-native-client` branch. Both preserve the TypeScript/Bun control plane
and exercise the same loopback APIs:

- The Rust/GPUI experiment implements a separate renderer. It demonstrates
  strong custom-paint performance and precise Atlas control, but requires a
  second presentation implementation. Accessibility, IME, terminal hardening,
  process lifecycle and live transport reliability remain material adoption
  risks.
- The AppKit/WKWebView experiment wraps the maintained React renderer. It selects
  a loopback port, launches and supervises the Bun sidecar, waits for readiness,
  retains the existing HTTP/SSE/WebSocket and origin checks, and provides native
  window and menu lifecycle. It does not introduce a native-JavaScript bridge or
  another control plane.

Initial September 2026 evidence makes WebKit the lower-risk end-to-end baseline,
not the accepted winner. The WebKit prototype rendered and shut down in five of
five automated trials. The comparable GPUI live-server run rendered in two of
five trials despite healthy server and SSE responses, indicating an unresolved
native transport path. Those timings included accessibility and screenshot
automation and are not input-to-photon measurements. The first self-contained
WebKit package was approximately 212 MB on disk and its measured app, Bun and
WebKit process group used approximately 472 MiB RSS for the sampled portfolio;
both require optimization and a fair full-system comparison. GPUI's smaller
renderer measurements excluded its external Bun server and therefore are not
direct package or process-tree comparisons.

The current product direction is to continue improving the single React UI and
to evaluate WKWebView as its macOS delivery shell. Do not maintain the GPUI and
React renderers in parallel. GPUI should replace the renderer only if repeatable
evidence shows that the maintained web UI cannot meet a concrete interaction or
spatial-rendering requirement and GPUI also clears normal application-quality
gates.

Before adopting the WKWebView shell, demonstrate:

- responsive 10/100/500-Agent Atlas interaction with credible frame and input
  measurements;
- sustained terminal output, keyboard, clipboard and reconnect behaviour;
- VoiceOver, keyboard-only and IME workflows;
- acceptable cold launch, idle CPU and total process-tree memory;
- sidecar crash recovery, sleep/wake and clean application shutdown;
- a materially reduced, reproducible package; and
- Developer ID signing, notarization and update lifecycle.

Use Electron only if WebKit fails a measured requirement that Chromium solves.
Choose GPUI only if the resulting operator experience, rather than its technical
novelty, justifies the extra renderer, accessibility and terminal ownership.
Until these gates pass, the normal browser remains the accepted delivery path
and both native clients remain disposable evidence.

## Host and terminal integration

Observatory V1 is Herdr-native: Herdr is the required and supported live
execution host, not merely one interchangeable option that V1 must avoid using
fully. This is a product support decision, while `SessionHost` remains a
host-neutral architectural boundary. Herdr already exposes agent inventory,
state, worktree provenance, launch, close and terminal operations. Only
`src/hosts/herdr/` and composition code may know Herdr protocols or native
identifiers.

The authority split is deliberate. Herdr owns execution presence, location,
coarse runtime state, attachment and closeout revalidation. Provider hooks own
optional provider-semantic evidence such as human-input requests, turn outcomes
and context pressure. Hooks cannot admit an Agent, prove process presence or
absence, complete semantic work, or replace a fresh Herdr check for a sensitive
operation. Hook delivery is ephemeral and best effort; received observations
are operational evidence rather than accepted Universe state.

The browser asks the loopback server to open an accepted Agent. The server:

1. re-resolves generic `AgentAccess` through `SessionHost`;
2. opens a host-owned terminal with bounded dimensions;
3. upgrades a random process-local handle to an origin-checked WebSocket;
4. carries ordered frames, input, resize and scroll messages over that socket; and
5. releases all sessions on shutdown.

xterm.js renders those frames in the browser. It does not persist terminal
history, create a PTY or receive a concrete Herdr target. Linked executions use
the same capability and remain transient tabs, not Universe objects.

The replacement test remains strict: a future tmux or other host adapter must
not require changes to Universe, persistence, projection or browser interfaces.
That testability does not make alternative hosts V1 scope.

Remote execution, distributed host aggregation and an Observatory edge
collector remain deferred. If remote Herdr becomes supported, the preferred
direction is one authoritative Observatory. A host-local durable outbox and
authenticated outbound forwarding should be added only if remote disconnection
recovery becomes a demonstrated requirement. Running one independent
Observatory per VM is appropriate only for intentionally separate trust domains;
federating their semantic Universes is not the default remote-host design.

## Local transport

The current product is one in-process, single-user application:

```text
Browser -------> 127.0.0.1 HTTP mutations + SSE projections + terminal WebSockets
                                      |
                                      v
                         Universe + SessionHost + SQLite
Optional provider observations -> authenticated POST -> harness receiver
```

Browser mutation endpoints require exact loopback Origin, JSON content type and
an explicit intent header. The separate provider ingress requires a per-install
bearer token, accepts only bounded JSON and has no CORS. The browser receives
narrow projections and operation results, never SQLite records, arbitrary
filesystem paths or the internal command union.

Host snapshots are polled. Browser projections use revisioned SSE replacements,
with HTTP refresh for startup and recovery. A future provider-observation plugin
may trigger immediate reconciliation through the same in-process boundary; no
provider hook is installed by the built-in configuration. This transport remains
in the existing Bun process; it does not require a daemon.

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

Source folders follow the module ownership documented in the
[technical architecture](technical-architecture.md). Directory layout may evolve
without changing those interfaces. Do not add pass-through layers before a real
variation or consumer creates a seam.

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
