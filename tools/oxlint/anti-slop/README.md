# Vendored Anti-Slop Oxlint plugin

This directory is copied from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)
for local, pinned Oxlint execution. Observatory currently tracks upstream
commit `6d538555cb151d4121ed51a27db81890eacf8ae9`.

The plugin is intentionally vendored so lint does not depend on a runtime GitHub
checkout. To update it, review the upstream changes, rerun the repository's
installer, update this commit reference, then run `bun run check` and `bun test`.
The vendored path is ignored by the application lint and formatter; maintained
Observatory source is still required to pass every enabled Anti-Slop rule.
