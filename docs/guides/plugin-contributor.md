# Contributing an Observatory plugin

Observatory V1 loads trusted local plugin packages through a versioned manifest.
The implemented capabilities are `code-host` and `agent-harness`.

Start from [`examples/plugins/code-host`](../../examples/plugins/code-host). A
package contains `observatory.plugin.json` and one entrypoint exporting
`plugin.activate(context)`. Activation returns contributions; it must not mutate
Observatory state or register callbacks globally.

For a coding-agent CLI, start from
[`examples/plugins/agent-harness`](../../examples/plugins/agent-harness). An
`AgentHarness` implements availability, genuinely new-session planning,
exact-session resume and continuity proof. It returns an executable and
argument array; it never starts a process or receives a concrete host adapter.
Lifecycle flags and native conversation references belong to the harness and
must not be accepted as unchecked caller overrides.

The current public SDK is [`src/plugin-sdk/index.ts`](../../src/plugin-sdk/index.ts).
Its main contracts are `ObservatoryPlugin`, `PluginContext`,
`CodeHostingProvider` and `AgentHarness`. The SDK remains source-local until the API has survived
GitHub dogfood; contributed packages may use a relative import while developing
inside this repository.

## Configuration

Set `AO_PLUGIN_CONFIG` to an absolute JSON file using this shape:

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "path": "/absolute/path/to/plugin-package",
      "enabled": true,
      "config": {}
    }
  ]
}
```

Configuration is read on startup. V1 has no automatic install, marketplace,
hot reload or sandbox. A plugin runs in-process with Observatory's filesystem,
environment and network permissions, so enabling it is equivalent to installing
other trusted local developer tooling. Keep secrets in the provider's credential
store. The built-in GitHub plugin uses the installed `gh` authentication and
never receives or persists a token.

## Contract

An agent harness must:

- report unavailable executables without returning raw stderr;
- create a genuinely new native conversation, without accepting caller flags
  that silently resume another one;
- let the provider generate new-session identity and document how the host can
  observe it; do not allocate a provider identifier merely to make launch
  synchronous;
- resume one exact opaque native conversation and fail closed for an invalid
  or differently namespaced reference;
- distinguish `same`, `replaced`, `absent` and `unknown` continuity from typed
  host evidence; and
- keep prompts, credentials and native conversation values out of logs and
  diagnostics.

Adding a harness changes only its plugin package and local plugin
configuration. It must not require edits to Herdr, another `SessionHost`, the
Universe, persistence, projections or renderers.

A code-host provider must:

- return `false` for unsupported normalized repository hosts;
- use only the bounded process runner provided in `PluginContext` for commands;
- return provider-neutral, browser-safe metadata rather than raw API payloads;
- return an empty list when no pull request matches;
- distinguish authentication, rate-limit, unavailable and invalid-response
  failures with `CodeHostError`; and
- avoid pull-request bodies, comments, CI logs and credentials.

The registry rejects incompatible manifests, duplicate plugin or harness IDs,
and capability contributions that do not match the manifest. A failure
degrades that plugin and does not alter Goal or Agent state.
