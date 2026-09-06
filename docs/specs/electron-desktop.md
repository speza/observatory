# Electron desktop delivery

Status: initial implementation; Linux mock/degraded checks available, live Mac handoff pending

Updated: 2026-09-06

Depends on:

- [Technology decisions](../design/technology-decisions.md)
- [Technical architecture](../design/technical-architecture.md)
- [Browser terminal interaction](../design/terminal-interaction.md)
- [Feature roadmap](observatory-feature-roadmap.md)

## Decision and timing

Implementation entry points now exist in `desktop/`; see the README for build,
configuration and development commands. Automated backend tests cover private
startup, HTTP/SSE authentication, port conflict, database release and parent
death. The initial bundle includes the builder's Bun runtime with recorded version
metadata; release-grade toolchain enforcement remains part of distribution work.
Mac/Finder, live Herdr, sleep/wake, OS input conventions and resource budgets are
not yet verified. The acceptance requirements below remain gates, not claims of
completion. Desktop development uses Vite on 4330 with backend 4331; packaged
live mode retains 4310 and mock uses 4320 to avoid accidental live-hook delivery.

Make Electron the primary desktop delivery for Observatory, with macOS as the
first supported platform and Linux as a future target, including keyboard-driven
Wayland environments such as Omarchy. Retain React, SVG/CSS and xterm.js as one
maintained UI. Keep the browser workflow for fast development, deterministic
tests and comparison; do not build a separate desktop feature implementation.

Implement a thin, maintained desktop slice now, alongside supervision and review
work. Do not delay all desktop validation until the product is finished, or make
installer and update infrastructure a prerequisite for further product learning.
Swift, Tauri, a UI rewrite and a backend runtime migration are not this direction.

Electron is a delivery choice, not evidence of better UX or lower resource use.
The first slice must establish lifecycle correctness and measure its overhead.

### First handoff

An unpublished Mac application that launches from Finder and works with a live
Herdr-hosted Agent is the first deliverable. A mock-only bundle is an internal
checkpoint, not a completed handoff. Herdr must already be installed and running;
Observatory connects to it but does not install, start, supervise, update or stop
the Herdr server in this slice. Existing explicit Agent lifecycle commands remain
available through SessionHost; they are not server lifecycle management.

## Architecture and ownership

```text
Electron main process
    ├── application/window lifecycle, menus, external-link policy
    ├── starts and supervises one bundled Bun child
    └── sandboxed renderer: existing React/SVG/xterm client
                   │ HTTP + SSE + terminal WebSocket
                   ▼
          Bun loopback composition root
                   ├── Universe / projections / SQLite
                   ├── provider and repository plugins
                   └── SessionHost → Herdr
```

- Proposed `desktop/` owns Electron main, a minimal preload only if needed,
  packaging and desktop lifecycle tests. It must not import the Universe,
  persistence or concrete host adapters.
- `src/web/` remains the imperative control-plane edge. Add explicit startup,
  readiness and shutdown support here rather than creating a pass-through
  desktop backend service or moving domain work into Electron.
- `web/src/` remains the only product renderer. Domain commands and terminal
  actions continue through the existing typed gateways, not Electron IPC.
- Electron uses its Node runtime; the backend still uses Bun and `bun:sqlite`.
  Do not assume Electron can execute the existing backend directly.
- Package a pinned Bun executable, backend code, built-in plugin packages and
  built web assets. Resolve resources from the installed bundle, never cwd or a
  source checkout. Keep executable resources outside archives where necessary.
  A clean-machine mock launch must not need a separately installed Bun or Node.

Production loads the built client from the owned loopback backend, preserving
same-origin HTTP/SSE/WebSocket semantics. Development may load Vite using the
existing proxy workflow and exact development-origin configuration. No remote
site supplies executable application UI in a packaged build.

## Backend startup and endpoint ownership

The shell launches the backend with structured arguments and explicit resource,
data and configuration paths. Use a private parent/child channel for a versioned
readiness record containing the bound endpoint and startup identity; do not scrape
human console output. Only load the product window after readiness is confirmed.
Fail visibly on timeout, incompatible protocol or early child exit. Diagnostics
must be bounded and exclude credentials, terminal output and private file content.

Initially retain a stable configured loopback port (currently 4310): installed
provider hooks embed an endpoint, so choosing a random port on every launch would
silently break observation delivery. Port collision is an explicit startup error,
not permission to attach to an unknown server, kill its process or silently choose
a different port. A future endpoint change must include explicit hook repair.

Use a per-launch desktop session credential delivered through the private channel
and installed by main into an isolated Electron session, not a URL or renderer
local storage. Authenticate desktop UI assets and API access, including SSE and
WebSocket upgrades, with that session. Preserve exact authority/origin checks,
mutation intent headers and command allow-lists. The implementation must test the
chosen cookie/session mechanism across all three transports before broadening it.

Provider observation ingress keeps its separate user-owned bearer credential and
existing bounded POST contract. It must neither require the desktop credential
nor grant access to desktop APIs. Do not weaken standalone browser security to
accommodate Electron. Local same-user malware is not a security boundary this
session mechanism claims to solve.

## Application lifecycle

| Event                           | Required behaviour                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch                    | Show bounded startup progress, then the shared UI; offer retry and sanitised diagnostics on failure.                                                                            |
| Second app launch               | Focus/reopen the existing window, without starting another backend.                                                                                                             |
| Close window on macOS           | Release renderer terminal connections; keep the application/backend running until explicit quit. Dock activation recreates the window.                                          |
| Explicit quit or OS termination | Stop accepting new work, detach streams, finalise backend resources and close SQLite; wait for a bounded graceful shutdown, then terminate only the owned backend if necessary. |
| Renderer crash/reload           | Keep the backend; offer reload and reacquire a fresh projection baseline and terminal capabilities. Never replay terminal input or mutations automatically.                     |
| Backend crash                   | Show disconnected/recovery state and disable stale actions; explicit retry starts one new backend after the previous child has exited. No infinite restart loop.                |
| Main process crash              | Backend detects parent-channel closure and exits; verify no orphan listener remains.                                                                                            |
| Sleep/wake                      | Reconnect and reconcile; stale facts stay uncertain until refreshed. No replay of potentially completed launch/close requests.                                                  |

Quitting Observatory is never a command to stop Agents, close Herdr executions,
archive work or complete Goals. A forced backend exit may leave an operation
outcome uncertain; existing receipts and reconciliation, not blind resubmission,
must resolve it. Provider hooks remain best-effort: events sent while Observatory
is quit are not promised durable delivery. This slice adds no daemon or outbox.

One window and one backend per desktop profile are sufficient initially. The
Electron single-instance lock does not protect against a separately launched web
server: acquire an exclusive ownership lock for the canonical database path before
opening the store in either entry point. Test concurrent startup and stale-lock
recovery; SQLite write serialization alone is not application-level ownership.

## Data, configuration and live-host setup

- Store desktop data under Electron's stable per-user application-data directory,
  independent of installation/version/cwd. Keep window bounds and renderer
  preferences separate from trusted semantic SQLite records.
- Mock and live profiles have separate databases, sessions and configuration.
  Never seed mock work into a live database.
- Existing web data currently defaults to `data/ao.sqlite` under cwd. Do not
  silently relocate, overwrite or reset it. The first slice uses a new desktop
  profile; an explicit existing-data selection/import workflow is a later gate.
  Do not copy an active SQLite file without its transactional state.
- Existing hook endpoint/token configuration must remain usable when deliberately
  sharing it. Development profiles must not rewrite live hook configuration.
- GUI launch must not rely on shell startup files or developer PATH. Provide
  explicit configuration and bounded diagnostics for required external tools and
  host availability. Validate from Finder, not only a terminal.
- Herdr remains an external, required live host. Missing/unavailable Herdr gives
  an actionable degraded state, not silent mock mode or inferred absence.
  Connection configuration and tested installation/start guidance are required
  for the first live handoff, not deferred to external distribution.
- Incompatible database versions must fail with recovery guidance, not silently
  reset user work. Upgrade/migration and backup policy is a distribution gate.

### Herdr connection experience

Backend readiness means the local control plane is usable, not that Herdr is
healthy. A failed, deadline-bounded host check must not prevent the application
from opening its stored semantic state.

1. Attempt the configured Herdr connection at startup through SessionHost.
2. If available, reconcile and expose capabilities normally. Discovering an
   execution does not bypass existing Agent admission/identity rules.
3. If unavailable, show “Herdr isn't available”, the relevant connection
   configuration, sanitised diagnostics, installation/start guidance and an
   explicit **Retry connection** action. Keep persisted semantic state accessible;
   host facts remain stale or unavailable, never inferred absent. Host-dependent
   operations are unavailable with an explanation; semantic-only actions retain
   their existing authority rules.
4. Retry through the existing serialized refresh path, without spawning a second
   polling loop. When Herdr becomes available, reconcile and enable proven
   capabilities without restarting Observatory. Test both startup absence and
   loss/recovery after a successful connection.

The shared renderer presents generic host health and capabilities; Herdr-specific
configuration and setup diagnostics originate at the adapter/composition edge.
No native identifiers or server commands enter Universe or renderer interfaces.
Do not attach to an arbitrary discovered endpoint or execute setup commands from
untrusted diagnostics. There is no Start Herdr button in the first slice.

An explicit start action may be considered later after checking Herdr's actual
parent-exit, shutdown, version and configuration behaviour. Bundling, updates and
service management need a separate decision; do not assume restarting a Herdr
server preserves its executions.

## Security and desktop behaviour

Use sandboxed renderers, context isolation, disabled Node integration and normal
web security. Apply a production content security policy compatible with the
actual renderer; development allowances must not leak into packaged builds.
Never expose generic filesystem, process execution or arbitrary IPC to the UI.
Validate sender/frame and arguments for any narrow preload capability added.

Block unexpected navigation, popups, webviews and permission requests by default.
Only explicit user-activated, validated HTTP(S) links may open in the external
browser; untrusted labels, terminal output or links cannot select arbitrary URL
schemes or become shell commands. Native terminal handoff remains a SessionHost
operation. Do not auto-open downloads or grant file access to remote content.

The first Mac slice includes normal application/edit/window menus, quit/hide,
copy/paste, window focus and on-screen bounds restoration. Test shortcuts while
xterm has focus: app shortcuts and terminal control input must not steal each
other's intended actions. Exercise keyboard-only navigation, accessibility names,
IME/composition, clipboard paste, trackpad pan/zoom and display scaling.

Notifications, launch-at-login, tray/menu-bar UI, app deep links, multiple windows
and new persistent workspace restoration are deferred. Window bounds restoration
must not grow into automatic agent launch or terminal-input replay.

## Delivery stages and acceptance

### 1. Maintained mock desktop slice — internal checkpoint

Add proposed `desktop:dev`, `desktop:mock` and `build:desktop` commands, with
documented ownership of Vite/backend processes. Keep existing web commands usable.
Pick and pin one packaging tool during implementation; the first result is an
unpublished runnable app bundle, not an update service.

Acceptance: launch synthetic 20–40 Agent portfolios, pan/zoom Atlas, select and
edit a Goal, use the inspector/review surfaces, and exercise mock terminal input,
resize and detach. Verify persistence across restart, profile isolation,
single-instance/database locking, port conflict, startup failure, renderer crash,
backend crash, parent crash, close/reopen and explicit quit. Missing/invalid
credentials, foreign origins, navigation and IPC misuse must fail closed.

Inspect rendered default and failure states, and run the unchanged core suite.
Test the installed resource layout outside the repository with Bun/Node absent
from PATH. A development window loading Vite alone does not satisfy this stage.

### 2. Mac live session — required first handoff

On a real Mac, use an independently installed/running Herdr server and at least
one disposable live Agent. Launch the packaged application from Finder, discover
the conversation and select or explicitly admit the Agent through the existing
workflow. Open its exact terminal, send input and observe the response, resize,
detach and return to Atlas. Verify live hook delivery across relaunch,
host loss/recovery and sleep/wake. Close/reopen the window and quit/relaunch the
application while work is active; confirm through SessionHost that the same
execution survives and can be reattached, with no duplicate launch.

Also start Observatory while Herdr is unavailable: the degraded state, guidance
and Retry connection must work, and starting Herdr externally must allow recovery
without restarting Observatory. Do not stop a shared Herdr server to test this;
use an isolated test setup. Check microphone or other permission prompts are not
requested without an implemented need.

Record hardware/OS, portfolio, active terminal count, build mode, cold/warm launch
times, idle CPU, aggregate shell/renderer/backend memory and pan/input latency.
Compare with the same production web build and backend, not Vite. Measure hidden
and visible idle states and active terminal streaming; check repeated open/close
cycles for resource growth. Establish numerical budgets from this baseline before
distribution; no invented performance claims. Sustained unexplained idle CPU,
resource growth, lost input or lifecycle failures block daily-default adoption.

macOS validation requires a Mac runner/manual evidence. Linux orb tests cannot
establish Mac focus, Finder environment, signing or sleep/wake correctness.

The handoff includes the runnable Mac bundle or reproducible local build steps,
tested Mac/Herdr versions, configuration/start instructions, executed live smoke
results, inspected screenshots of connected and unavailable states, resource
measurements and known limitations. Build steps without executed Mac/live evidence
are progress, not completion. Signing/notarisation is deferred, so document any
local-build launch restrictions without requiring users to disable OS security
globally.

### Development and test workflow

- Keep Vite/browser as the fast path for ordinary UI changes, with one renderer
  implementation and no desktop-only copies of product features.
- Keep core/domain, persistence, projection and mock host tests runnable with Bun
  without Electron or Herdr. A normal domain change must not require a desktop
  launch to verify it.
- Add a separate desktop integration suite for startup, authentication, window
  lifecycle, resource paths, backend cleanup and recovery. Use mock fixtures for
  deterministic CI; keep actual live smoke opt-in and use disposable Agents.
- `desktop:dev` should reuse Vite hot reload for renderer edits. Document which
  main/preload/backend edits require restart, where each process logs, and which
  process owns cleanup. Keep diagnostics sanitised and bounded.
- Exercise a packaged build regularly, not just development mode: Finder PATH,
  permissions and installed resources differ from a terminal-launched checkout.
- UI work needs representative browser verification plus desktop checks when it
  affects focus, shortcuts, clipboard or native integration. Shell/backend
  lifecycle changes require the desktop suite; Mac-specific and host integration
  changes require the relevant Mac/live smoke before being called verified.

The expected cost is concentrated in initial lifecycle/packaging setup and
platform validation, not a second implementation of every feature. Establish
actual test duration and maintenance cost during the first handoff rather than
promising a fixed overhead. Lack of Mac access does not block shared development,
but it does block claiming the live Mac milestone complete.

### 3. External distribution — later, explicitly authorised

Choose minimum macOS version and supported CPU architectures from actual
dependencies and target users. Add signing/notarisation, clean-machine installation,
upgrade and data-preservation checks, dependency licences and a documented
Herdr/tool setup path. Secure updates and rollback compatibility need a separate
release decision; no silent downgrade into an incompatible database. Publishing,
signing credentials and release infrastructure require explicit authorisation.

### 4. Linux support — when there is a concrete user

Reuse the UI/backend and test installation, tool discovery, window-manager
behaviour, clipboard, keyboard shortcuts, scaling and GPU behaviour on the chosen
Linux targets. Include Wayland/Hyprland for Omarchy before claiming support.
Define Linux last-window/quit conventions explicitly rather than inheriting Mac
behaviour by accident. Select package formats then; cross-compilation alone is
not platform support. Windows is not a committed target in this spec.

## Non-goals

No second client, native UI rewrite, Electron-owned SQLite/domain state, host
protocol leakage, remote control plane, daemon, multiplexer, transcript ingestion,
automatic semantic lifecycle actions or changes to the System → Goal → Agent model.
This specification authorises planning; it does not claim implementation or
authorise commits, publishing or shared infrastructure changes.
