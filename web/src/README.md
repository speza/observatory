# Web renderer modules

The browser is a renderer over trusted server projections. It keeps navigation and presentation state locally, submits commands through the loopback transport, and does not recreate Universe or host semantics.

## Structure

- `app/` — composition, browser-local navigation, and projection polling.
- `api/` — the transport seam: request execution and response decoding.
- `atlas/` — the spatial universe implementation, camera, geometry, and presentation policy.
- `systems/`, `goals/`, `agents/` — System → Goal → Agent workflows.
- `attention/`, `inbox/`, `inspector/`, `ledger/`, `search/` — supporting product lenses.
- `terminal/` — host-owned terminal rendering and interaction.
- `workspace-review/` — transient read-only working-tree review.
- `settings/` — persisted browser presentation preferences.
- `shared/` — genuinely cross-feature visual primitives and brand assets.

Tests stay beside the implementation they exercise. Feature modules may depend on `api/`, `settings/`, and `shared/`; they should not import another feature's implementation merely to obtain a shared type. Browser-wide interaction types belong in `app/`.

Keep interfaces narrow. Do not turn this layout into generic `components/`, `hooks/`, or `utils/` buckets, and do not add barrel files solely to shorten imports.
