# Publication audit fix checklist

Temporary working checklist for the pre-publication audit. Keep the repository private until every required item and final verification below is complete. Do not change repository visibility without explicit confirmation.

## 1. Remove private/employer material

- [x] Replace the real employer-specific goal name in `web/src/atlas/Atlas.test.tsx` with a synthetic name.
- [x] Search the maintained tree case-insensitively for employer names, private project names, personal paths, credentials, and real session material.
- [ ] Rewrite reachable `main` history so the old test value is not present in public history.
- [ ] Coordinate the rewrite with existing worktrees so an old branch cannot merge the removed history back into `main`.
- [ ] Verify all public/reachable refs are clean after the rewrite.
- [ ] Rewrite remaining `Amp <amp@ampcode.com>` author identities and ensure all reachable commits use `Sam Perrin <samtperrin@gmail.com>`.

## 2. Close the loopback HTTP boundary

- [x] Reject requests whose effective host/authority is not the configured loopback authority.
- [x] Reject a present foreign `Origin` on all API requests, including reads and SSE.
- [x] Preserve same-origin browser requests that omit `Origin` on GET.
- [x] Keep the existing JSON and explicit-command-header checks for mutations.
- [x] Add real Bun HTTP-boundary tests proving a foreign `Host` cannot read portfolio or diff data.
- [x] Add API tests for foreign-origin GET and terminal event requests.
- [x] Review browser projections for unnecessary opaque host identifiers; retain the operator-visible host kind/execution ID but remove host locator, host-instance and observation timestamp from browser Agent views.

## 3. Enforce provider-observation monotonicity

- [x] Track the latest accepted provider catalogue timestamp per provider instance and continuity scope.
- [x] Reject/ignore older provider catalogues before complete snapshots can delete conversations or mark continuity missing.
- [x] Reject/ignore older agent-observation snapshots before complete snapshots can clear current evidence or regress cursors/health.
- [x] Ensure an unavailable observation cannot overwrite a newer successful source state.
- [x] Return accurate accepted/diagnostic results from the Universe observation boundary.
- [x] Add tests for fresh-then-stale complete catalogues in both Universe and SQLite paths.
- [x] Add tests for fresh-then-stale complete metadata-observation snapshots.
- [x] Keep the documented guarantee that out-of-order observations do not regress accepted state.

## 4. Repair launch receipt semantics

- [x] Do not leave an unrecoverable pending receipt when validation, harness availability, workspace preparation, planning, or pre-launch host observation fails.
- [x] Distinguish retryable pre-launch failure from post-launch uncertainty where duplicate process creation is possible.
- [x] Ensure retrying the same request ID after a pre-launch failure returns an accurate durable failure rather than falsely claiming an observed launch.
- [x] Prevent setup failure from creating a requested Goal by validating setup and host availability before materialising it; retain the Goal after an attempted placement to preserve uncertain human intent.
- [x] Preserve exactly-once protection once host launch may have occurred.
- [x] Add restart-backed SQLite receipt tests and concurrent duplicate-request tests.
- [x] Update `docs/specs/session-launch.md` for the durable state machine.

## 5. Bound and serialize refresh/process work

- [x] Replace overlapping `setInterval` refreshes with serialized/coalesced loops.
- [x] Add deadlines and termination for noninteractive Herdr commands.
- [x] Bound retained Herdr stdout and stderr while continuing to drain safely.
- [x] Apply a timeout to the shared bounded plugin/repository and workspace process runners.
- [x] Validate refresh interval and timeout environment variables rather than accepting invalid/zero values.
- [x] Add tests for hung commands, oversized output, timeout cleanup, and non-overlapping refreshes.
- [x] Document polling as a temporary V1 mechanism and retain event-driven host observation as future work.

## 6. Correct provider update reporting

- [x] Compare provider reconciliation by stable Agent ID and meaningful value changes, not cloned object identity/index.
- [x] Report only truly updated Agent IDs.
- [x] Confirm provider catalogue reconciliation does not add or consolidate Agent membership; those paths remain command/host reconciliation responsibilities.
- [x] Add unchanged, changed, stale, and repeated provider-unavailable reporting tests.

## 7. Deferred: semantic history and persistence strategy

- [ ] After items 1–6, decide on retention semantics for acknowledged catch-up history.
- [ ] Decide whether to compact, archive, or incrementally persist `universe_changes`.
- [ ] Evaluate replacing whole-Universe delete/reinsert saves with incremental persistence.
- [ ] Until decided, do not weaken the product invariant merely to match the current implementation.

## Documentation reconciliation

- [x] Update `docs/design/technical-architecture.md` to match implemented HTTP boundary, observation freshness, polling/deadline behavior, and process limits.
- [x] Keep the out-of-order-observation guarantee only after tests prove it.
- [x] Remove the inaccurate current “bounded semantic changes” claim while leaving the retention decision deferred under item 7.
- [x] Check README capability/security wording against the final implementation.

## Final verification

- [x] `bun run format`
- [x] `bun run check`
- [x] `bun test` (278 passing)
- [x] `bun run build:web`
- [x] Smoke `bun run web:mock` through the loopback server.
- [x] `bun audit`
- [ ] Gitleaks scan passes on the rewritten reachable history.
- [x] Documentation links pass.
- [ ] Working tree is clean and `main` matches the intended remote commit.
- [ ] CI is green.
- [ ] Repository remains private until explicit authorization to publish.
