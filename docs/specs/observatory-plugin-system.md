# Observatory plugin system

Status: Slice 1 implemented

Date: 2026-08-27

Implementation checkpoint: the versioned local manifest loader, trusted
in-process registry, bounded process context, health diagnostics, synthetic
contract plugin, built-in GitHub plugin and external contributor example are in
place. Marketplace installation, hot reload, isolation and SDK publication
remain deferred as designed.

Depends on:

- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Agent repository status and code-host plugins](agent-repository-and-code-host-plugins.md)
- [Provider-native Agent observations](provider-native-agent-observations.md)

## Why

Observatory needs optional integrations without making every provider a core
special case. The project should be able to ship a GitHub plugin while another
contributor can add GitLab or Bitbucket without editing the Universe, SQLite,
projections or renderers.

The plugin system must be real enough to support external contributions. It
must not become a marketplace, dependency manager or universal extension
framework before one capability proves useful.

## Product decisions

- V1 plugins are local packages explicitly configured and enabled by the user.
- Plugins run in-process and are trusted with the same local permissions as
  Observatory. The UI and documentation must state this plainly; V1 does not
  claim sandboxing.
- A plugin contributes typed capabilities through a versioned SDK. It does not
  receive the Universe, SQLite connection, concrete `SessionHost` or renderer.
- The first contributed capability is `code-host`, implemented by GitHub and a
  synthetic test plugin. The next accepted category is `agent-harness`, driven
  by the concrete new-session, exact-resume and cold-restart workflow. See
  [Agent harness plugins](agent-harness-plugins.md).
- Built-in and third-party plugins use the same manifest, activation lifecycle
  and contract tests.
- Plugin failure or removal cannot corrupt or remove trusted Observatory state.
- No arbitrary plugin discovery. Observatory loads only built-ins and package
  paths named in explicit local configuration.

## Package contract

Each plugin package contains an `observatory.plugin.json` manifest that can be
validated without executing plugin code:

```json
{
  "schemaVersion": 1,
  "id": "github",
  "displayName": "GitHub",
  "version": "0.1.0",
  "apiVersion": 2,
  "entrypoint": "./dist/plugin.js",
  "capabilities": ["code-host"]
}
```

Rules:

- `id` is globally unique, stable, lower-case and namespaced for configuration
  and diagnostics.
- `version` is the plugin package version; `apiVersion` is the Observatory
  plugin interface major version.
- `entrypoint` must resolve inside the configured plugin package.
- Declared capabilities must exactly match the contributions returned during
  activation.
- Unknown manifest fields are rejected in V1 so misspellings do not silently
  alter trust or capability behaviour.

## SDK interface

Publish the small interface as `@observatory/plugin-sdk` once an external
example package exists. Until then it may live as a workspace package with the
same public shape.

```ts
interface ObservatoryPlugin {
  activate(context: PluginContext): Effect<PluginActivation, PluginError>;
}

interface PluginContext {
  readonly pluginId: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly clock: PluginClock;
  readonly logger: PluginLogger;
  readonly process: BoundedProcessRunner;
}

interface PluginActivation {
  readonly agentHarnesses?: readonly AgentHarness[];
  readonly codeHosts?: readonly CodeHostingProvider[];
  readonly dispose?: () => Effect<void, PluginError>;
}
```

Activation returns contributions rather than mutating a registry through
callbacks. The plugin context is namespaced and deliberately excludes mutable
kernel objects. `BoundedProcessRunner` accepts an executable plus argument
array, timeout and output limit; it does not expose shell interpolation.

The first capability interface is:

```ts
interface CodeHostingProvider {
  readonly providerId: string;
  supports(repository: RepositoryIdentity): boolean;
  pullRequests(revision: GitRevisionIdentity): Effect<readonly PullRequestStatus[], CodeHostError>;
}
```

Provider-specific response objects do not cross this interface. The repository
status module owns correlation, caching, ambiguity and merge-readiness rules.

`agent-harness` is the second implemented manifest capability. Provider-native
observation is not a third top-level capability: an `AgentHarness` may expose a
versioned `observationSource` sub-capability beside its existing catalogue,
start, resume and continuity methods. Existing harnesses remain valid without
it. The source returns bounded normalised snapshots through Effect; it receives
no persistence or Universe handle. See
[Provider-native Agent observations](provider-native-agent-observations.md).

## Loading and lifecycle

```text
configured package path
  -> read and validate manifest
  -> reject duplicate id or incompatible API version
  -> import declared entrypoint
  -> activate with namespaced context and timeout
  -> validate returned capabilities against manifest
  -> ready | degraded | disabled diagnostic
  -> dispose on Observatory shutdown
```

Configuration is local and explicit, initially through one versioned JSON file
under Observatory's normal config directory. Each entry contains package path,
enabled state and namespaced non-secret configuration. Secrets remain with the
provider's own credential mechanism; the GitHub plugin uses `gh`
authentication and Observatory never stores its token.

V1 does not hot-reload plugins. Configuration changes take effect on restart.

## Registry and health

The plugin registry is a deep module with a small read-only interface:

```ts
interface PluginRegistry {
  agentHarnesses(): readonly AgentHarness[];
  codeHosts(): readonly CodeHostingProvider[];
  status(): readonly PluginStatus[];
  close(): Effect<void, never>;
}
```

It owns manifest validation, loading, activation ordering, duplicate handling,
timeouts, diagnostics and disposal. Consumers ask for a capability collection;
they never look up entrypoints or import plugins themselves.

Plugin status exposes id, display name, package version, API version,
capabilities, lifecycle state and bounded diagnostics. It must never expose
credentials or raw provider responses. The web may render this in a small
Integrations/diagnostics surface; normal Agent views show only capability
results and precise unavailable states.

## Trust and isolation

In-process plugins can read files, environment variables and network resources
available to Observatory. Installation is therefore equivalent to installing
and running other local developer tooling.

V1 mitigations are:

- explicit package paths and enablement;
- no automatic marketplace installation;
- manifest validation before code execution;
- API compatibility and duplicate-id checks;
- bounded calls, structured diagnostics and failure isolation at capability
  invocation;
- no direct kernel/database/renderer references in `PluginContext`; and
- a visible trusted-plugin warning in configuration documentation.

An out-of-process JSON protocol may later implement the same serializable
interfaces when untrusted plugins, crash isolation or another implementation
language becomes a real requirement. Do not build both transports initially.

## Testing and contributor experience

- A synthetic code-host plugin proves loading, activation, capability use,
  diagnostics and disposal without GitHub or network access.
- A reusable contract suite verifies every `CodeHostingProvider` for supported,
  unsupported, empty, malformed-provider and failure paths.
- Loader tests cover invalid manifests, incompatible API versions, duplicate
  ids, missing entrypoints, activation failure and capability mismatch.
- The GitHub plugin passes the same capability contract using sanitized `gh`
  fixtures plus a read-only live smoke.
- An example external package and contributor guide prove that a code-host
  plugin can be built and enabled without importing Observatory internals.
- Core tests run with no third-party plugins installed.

## Delivery plan

### Slice 1 — real plugin seam

- Define manifest schemas, plugin lifecycle types and `code-host` capability.
- Implement the configured loader, registry, bounded context and status
  diagnostics.
- Add a synthetic external-style plugin fixture and contract suite.
- Keep Herdr on the existing `SessionHost` seam; do not wrap it in a plugin
  pass-through.

### Slice 2 — GitHub through the plugin system

- Package the GitHub implementation as a built-in plugin using the same SDK.
- Connect its `CodeHostingProvider` contribution to Agent repository status.
- Add local configuration and a plugin status/diagnostics response.
- Prove disabled, missing `gh`, unauthenticated, rate-limited and healthy states.

### Slice 3 — contribution proof

- Extract/publish the SDK when the interface has survived GitHub dogfood.
- Add the contributor guide and minimal example plugin.
- Prove a second synthetic GitLab-shaped plugin can be enabled without core
  changes; a production GitLab plugin is not required for the proof.
- Consider install/list/doctor commands only after manual configuration becomes
  the measured bottleneck.

## Acceptance

- A configured external example plugin contributes code-host facts without an
  Observatory core edit.
- Disabling, breaking or removing it leaves Goal and Agent state intact.
- The registry rejects incompatible or dishonest manifests before exposing
  their capabilities.
- GitHub and the synthetic plugin pass one shared contract suite.
- No plugin receives mutable kernel state or causes provider-specific fields to
  enter the renderer.
- Plugin health explains configuration, authentication and provider failures.
- Core startup and tests remain valid with zero optional plugins.

## Non-goals

- Marketplace, remote catalog, automatic download or dependency resolution.
- Sandboxing or permission prompts for V1 trusted local plugins.
- Hot reload.
- Arbitrary renderer injection, CSS injection or direct SQLite access.
- A universal capability model designed ahead of concrete integrations.
- Repackaging the existing Herdr adapter merely to claim plugin purity.
