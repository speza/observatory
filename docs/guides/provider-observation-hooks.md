# Provider observation hooks

Observatory can collect bounded provider-native activity from Claude Code,
Codex and Pi. Claude Code and Codex use small ordered command hooks; Pi uses an
extension over the same normalising writer. The writer stores only conversation
identity, coarse activity/tool categories, permission request lifecycle, turn
completion and compaction lifecycle. It discards prompts, messages, tool
arguments/results, commands, transcript paths and raw provider payloads.

## Install for local dogfooding

From this checkout, run:

```sh
bun run observations:install
```

The installer merges entries into, rather than replacing:

- `~/.claude/settings.json`;
- `~/.codex/hooks.json`; and
- `~/.pi/agent/settings.json`.

It is idempotent and retains existing hooks, packages and extensions. It publishes
content-addressed bundles under
`~/.local/share/observatory/hooks/build-<content-hash>/` and records the active
bundle in `installation.json`; changing branch or moving the checkout cannot
mutate installed hook code. Rerun the installer explicitly to publish and select
a new bundle. Codex may ask the operator to
trust newly added hook commands; review and approve those exact definitions in
Codex before relying on them.

Custom provider roots or outboxes must be supplied to both the harness plugin
configuration and the installer. The installer accepts `--claude-root`,
`--codex-root`, `--pi-root`, `--claude-outbox`, `--codex-outbox` and
`--pi-outbox`.

Normalised JSONL journals live under
`~/.local/state/observatory/observations/`. A sibling `.configured` marker lets
the built-in harness report the distinction between an installed-but-empty
source and one that was never configured. Until the first provider event, and
after a sufficiently long gap without one, the source reports stale rather than
claiming healthy delivery. Journals retain complete bounded current state plus
the latest 1,000 semantic transitions and are compacted atomically. The files
are local operational cache and must not be committed.

Restart the three provider CLIs after installation. Existing provider sessions
do not replay events that happened before their hook or extension loaded.

Verify the installation and retained journals without changing them:

```sh
bun run observations:doctor
```

The doctor checks the manifest, provider settings, bundles, markers and bounded
journal health through the same journal interface used by Observatory. It never
repairs files or claims that hook output is trusted; trust remains `unknown`.

## Remove

There is not yet an automatic uninstaller. Remove only the Observatory command
hook groups from the Claude and Codex JSON files and remove the installed
`pi-observation-extension.js` entry from Pi's `extensions` list. Other provider
hooks and Pi packages are unrelated and must remain intact. Removing the
`.configured` markers makes Observatory report the sources as not configured on
its next start.

## Evidence boundaries

Hooks provide the event source; Observatory polls the retained journal snapshot for
reconciliation and restart recovery. A hook never writes SQLite or accepted
Universe state. Missing, malformed, late or unsupported provider events remain
explicit uncertainty.
