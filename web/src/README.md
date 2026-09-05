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

## Atlas camera

Camera pan is absolute in renderer world coordinates, not relative to current portfolio bounds. Data refreshes do not refit the overview. Goal focus uses complete local bounds and the available viewport after side-panel reservations; active focus adapts to viewport/panel changes until manual pan or zoom takes ownership. System changes remount the camera deliberately. Keep background panel state while the terminal deck is open so entry, switching and return do not reframe the Atlas.

Bounds-fitting does not make every card readable. Detailed reading uses individual Agent focus or Ledger. The existing peer distribution and dynamic Goal spacing remain in place, so these camera fixes do not establish stable satellite ownership or eliminate all layout reflow.
