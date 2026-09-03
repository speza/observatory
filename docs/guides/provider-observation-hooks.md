# Provider observation hooks

Observatory can collect bounded provider-native activity from Claude Code,
Codex and Pi while its control-plane process is running. Claude Code and Codex
use small command hooks; Pi uses an extension over the same best-effort local
reporter.

The reporter sends only provider session identity, event name, turn identity
and tool name. The harness adapter immediately reduces those fields to coarse
activity/tool categories, permission-request lifecycle, turn completion and
compaction lifecycle. Prompts, messages, tool arguments/results, commands,
transcript paths and raw provider payloads are discarded.

## Operating model

The browser may be closed. The Observatory server is expected to remain running
while supervised Herdr Agents are active:

```text
provider hook -> authenticated loopback ingress -> harness observation source
              -> coordinator -> operational SQLite evidence -> projections
```

Delivery is ephemeral and best effort. The hook uses a 200 ms deadline and
returns successfully when Observatory or the network endpoint is unavailable.
There is no hook journal, replay or offline event reconstruction. On restart,
Herdr restores current execution truth and provider enrichment resumes with the
next event. Missing provider detail remains unknown.

Events received while Observatory is running are persisted in its bounded
operational evidence store and remain available to Catch up until acknowledged.
This is not a complete provider audit history.

## Install for local dogfooding

From this checkout, run:

```sh
bun run observations:install
```

The installer merges entries into, rather than replacing:

- `~/.claude/settings.json`;
- `~/.codex/hooks.json`; and
- `~/.pi/agent/settings.json`.

It publishes content-addressed bundles under
`~/.local/share/observatory/hooks/build-<content-hash>/`, creates a user-only
bearer token under `~/.local/state/observatory/`, and records the selected
bundle, endpoint and token path in `installation.json`. Existing provider hooks,
packages and extensions remain intact.

The default ingress is:

```text
http://127.0.0.1:4310/api/provider-observations
```

Use `--endpoint` when Observatory runs on another configured loopback port; the
URL must remain HTTP on `127.0.0.1` with the exact ingress path. Use
`--token-file` only when Observatory is started with the matching
`AO_OBSERVATION_TOKEN_FILE`. Custom provider roots use `--claude-root`,
`--codex-root` and `--pi-root`; configure the harness plugin with the same roots.

Rerunning the installer replaces earlier Observatory journal-writer hook groups
with the ephemeral reporter. Old files under
`~/.local/state/observatory/observations/` are ignored and may be deleted after
confirming the new installation.

Restart Observatory after installation so it loads the version-2 manifest and
token, then restart the three provider CLIs. Existing provider sessions do not
replay earlier events.

Verify installation without changing it:

```sh
bun run observations:doctor
```

The doctor checks the manifest, provider settings, bundles and token presence.
It cannot prove live delivery or provider trust.

## Remove

There is not yet an automatic uninstaller. Remove only the Observatory command
hook groups from the Claude and Codex settings and the installed
`pi-observation-extension.js` entry from Pi's `extensions` list. Do not remove
unrelated hooks or packages. Remove the Observatory installation manifest to
make the built-in source report `not-configured` after restart.

## Evidence boundaries

Hooks never write SQLite or accepted Universe state directly. The authenticated
ingress dispatches raw bounded fields to the owning harness adapter, then the
normal coordinator validates and correlates its snapshot. Hook evidence cannot
admit an Agent, prove process presence or absence, or change accepted lifecycle.
Malformed, missed, late and unsupported events remain explicit uncertainty.
