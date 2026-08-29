# Agent repository status and code-host plugins

Status: selected-Agent vertical slice implemented

Date: 2026-08-27

Implementation checkpoint: selected-Agent inspection now resolves the trusted
observed worktree server-side, reads bounded local Git state, normalizes the push
remote, queries the contributed code-host capability on demand, caches remote
facts for 60 seconds, preserves ambiguous associations, and renders Repository
status in the web inspector. Atlas and Closeout enrichment remain Slice 2.

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Observatory technical architecture](../design/technical-architecture.md)
- [Observatory plugin architecture](../design/plugin-architecture.md)
- [Observatory plugin system](observatory-plugin-system.md)
- [Observatory feature roadmap](observatory-feature-roadmap.md)

## Why

Runtime `done` does not answer whether an Agent's work is safe to integrate.
The operator still has to discover the checkout, inspect local Git state, find
the corresponding pull request, interpret checks and reviews, and remember
which result is blocked or ready. Across many Agents this becomes another flat
list of facts the operator must join mentally.

Observatory should perform that join and show the repository status on the
Agent:

```text
Herdr Agent
  -> trusted observed worktree
  -> local Git repository, branch and HEAD
  -> normalized GitHub repository
  -> matching pull request, checks, reviews and merge state from a code-host plugin
```

Herdr remains responsible for execution location and lifecycle. Observatory
owns Git and code-host inspection and correlation because these are repository
and merge-readiness facts, not session-host facts.

## Success

For a portfolio of at least 20 mixed Agents, the operator can identify without
opening every terminal:

- which Agents have uncommitted or untracked work;
- which branches contain unpublished commits;
- which Agents have a confirmed pull request;
- which pull requests have failing or pending checks, requested changes or
  merge conflicts;
- which done results still lack enough evidence to judge integration; and
- which Agent, checkout and pull request produced a selected result.

No pull request may be attached to an Agent through branch-name similarity
alone. A GitHub outage, missing authentication or deleted worktree must degrade
to explicit uncertainty without changing trusted Goal or Agent state.

## Product decisions

- Git and code-host facts enrich the durable `Goal -> Agent` model; repositories,
  worktrees, branches and pull requests do not become required Atlas nodes.
- The first implementation is read-only. Creating, approving, merging, closing
  or commenting on pull requests is out of scope.
- Local Git is the primary source for checkout, branch, HEAD, dirty state and
  divergence. A contributed code-host plugin is the source for pull-request,
  review, check and remote merge state; GitHub is the first implementation.
- The join is automatic for vanilla Agents. No agent skill or transcript
  ingestion is required.
- An optional future skill or hook may propose a pull-request URL, but the
  GitHub adapter must verify its repository and commit relationship before it
  becomes confirmed evidence.
- Green checks mean the reported checks passed. They do not prove correctness
  or automatically verify the result, complete a Goal, merge code or archive
  an Agent.
- Absence is precise: `no pull request found`, `GitHub unavailable`,
  `authentication required` and `association ambiguous` are different states.

## Operator workflow

### Atlas and Ledger

Agent cards use compact, progressively disclosed code status:

- dirty checkout;
- commits ahead of the integration base;
- confirmed pull-request number and draft/open/merged state;
- checks passing, pending or failing; and
- review or merge conflict requiring attention.

Goal bodies aggregate only actionable counts such as `1 failing` or
`2 awaiting review`. They do not repeat every repository detail or turn the
Atlas into a Git graph.

### Agent inspector

The inspector adds a **Repository** section:

1. local checkout status, branch, abbreviated HEAD and observed age;
2. uncommitted file/addition/deletion counts with the existing workspace review
   action;
3. base branch and ahead/behind counts when determinable;
4. confirmed pull request with title, number, base/head, author and update age;
5. check summary, review decision and merge state; and
6. an explicit explanation when status is partial, unavailable or ambiguous.

`Open on GitHub` follows the confirmed URL. `Refresh status` bypasses the
remote cache for that Agent within rate limits. The browser never supplies a
filesystem path, repository name, branch or pull-request URL for discovery.

### Closeout

Results to review show integration warnings before `Close & archive`:

- dirty or untracked local changes;
- commits not present in the confirmed pull-request head;
- failing required checks;
- requested changes;
- a reported merge conflict; or
- unavailable/ambiguous evidence.

`No pull request found` remains informational in the first slice because not
all Agent work should produce a pull request. A later Goal policy may declare a
pull request required; the first slice must not infer that requirement.

### Optional integration lens

A later Git lens may group Agents by repository and show branch convergence,
shared files and integration paths. It remains a derived supporting lens. The
first slice proves inspector, Closeout and attention value before adding it.

## Architecture

### Deep module

Add one deep `AgentRepositoryStatus` module at the control-plane edge. Its
external interface stays small:

```ts
interface AgentRepositoryStatusReader {
  inspect(
    agentId: AgentId,
    options?: { freshness?: "cached" | "refresh" },
  ): Effect<AgentRepositoryStatusSnapshot, RepositoryStatusError>;
}
```

The module owns the work callers must not repeat:

- resolve the active or historical Agent from a read-only Universe snapshot;
- select only its trusted, host-observed worktree;
- inspect and normalize local Git state;
- sanitize and normalize the branch's push remote;
- establish the integration base without assuming `main`;
- query code-host capabilities contributed by the plugin registry;
- correlate candidate pull requests and preserve ambiguity;
- combine provenance and observation ages;
- cache remote facts and bound concurrency; and
- return one browser-safe, provider-neutral snapshot.

The renderer, web transport, Closeout module and attention projection consume
this interface. They do not invoke Git, `gh`, GitHub or `SessionHost` directly.
The Universe is not modified by an evidence read.

### Internal seams

Local Git inspection is local-substitutable and remains internal to the deep
module. Reuse the existing bounded workspace diff behaviour rather than adding
a second diff implementation.

Code hosting is a true external dependency behind a contributed plugin
capability:

```ts
interface CodeHostingProvider {
  readonly providerId: string;
  supports(repository: RepositoryIdentity): boolean;
  pullRequests(revision: GitRevisionIdentity): Effect<readonly PullRequestStatus[], CodeHostError>;
}
```

The built-in GitHub plugin initially uses the installed, authenticated `gh` CLI
with structured JSON output. A synthetic plugin is the deterministic path.
Both load through the versioned plugin system and pass the same capability
contract. See [Observatory plugin system](observatory-plugin-system.md).

### Evidence model

The normalized snapshot contains:

```text
AgentRepositoryStatusSnapshot
  agentId, status, observedAt, diagnostics
  git
    worktree, repository identity, branch, detached
    HEAD identity, dirty/untracked summary
    integration base, ahead/behind, unpublished commits
    bounded working-tree diff summary
  pullRequests[]
    provider, kind, externalId, url, title
    lifecycle, association, observedAt, provenance
    pullRequest
      base/head refs and OIDs
      draft/state, checks, review decision
      mergeability and merge-state summary
```

Statuses are `complete`, `partial`, `unavailable` or `not-applicable`.
Association is one of `confirmed`, `candidate` or `ambiguous`; it is never a
numeric confidence score. Provider-specific payloads stay inside the adapter.

### Correlation rules

The module joins evidence in this order:

1. Resolve the Agent's trusted observed worktree server-side.
2. Resolve the Git root, current branch, HEAD, configured upstream and push
   remote from that checkout.
3. Normalize supported GitHub SSH/HTTPS remote forms to
   `hostname/owner/repository` without retaining embedded credentials.
4. Query the exact repository for pull requests associated with the local
   branch and collect structured head repository, head branch and head OID.
5. Confirm the association when repository identity and head identity agree.
   If the local branch is ahead of the pull-request head, retain the PR
   association but report unpublished commits explicitly.
6. Return multiple candidates as ambiguous. Do not choose the newest or a
   same-named branch silently.

Detached HEADs, fork pull requests, renamed branches, merged pull requests and
multiple remotes must have explicit fixtures. Fork support may use a more
precise GitHub query than `gh pr list --head`, whose current CLI syntax does not
accept `owner:branch`; the adapter interface must not expose that limitation.

### Freshness and cost

Ordinary portfolio polling must not query GitHub for every Agent.

- Inspector selection reads local Git immediately and uses remote evidence
  cached by repository/branch/HEAD.
- Remote evidence defaults to a short TTL, initially 60 seconds.
- Closeout may prefetch done Agents with bounded concurrency and reuse the same
  cache.
- A changed HEAD invalidates the relevant association cache entry.
- Manual refresh is per Agent and reports rate-limit or authentication errors.
- The first slice keeps evidence transient. Persist only if real catch-up or
  restart requirements cannot be met by bounded snapshots and cache.

## Failure and uncertainty semantics

- Missing worktree: report `unavailable`; do not fall back to the server's
  current working directory.
- Non-Git directory: report `not-applicable`.
- Deleted stale worktree: preserve the last host observation but report the
  current evidence read as unavailable.
- Missing/unsupported remote: show local Git status and `no supported code-host
repository`.
- Missing `gh` or authentication: show local Git evidence and an actionable
  GitHub diagnostic.
- Network/rate-limit/provider failure: serve non-expired cached evidence when
  present, mark it stale, and expose the failure.
- No matching PR: return a successful empty result, not an error.
- Multiple plausible PRs: return candidates as ambiguous and suppress
  PR-derived integration-ready claims.
- Malformed provider output: reject that observation and retain kernel state.

## Security and privacy

- The web accepts only an Observatory Agent ID and an optional refresh intent.
- Worktree resolution happens server-side from accepted Agent metadata.
- Git and `gh` commands use argument arrays with bounded output; no shell
  interpolation or browser-provided command fragments.
- Remote URLs are normalized and credentials are removed before projection or
  diagnostics.
- Observatory never reads or stores GitHub tokens; `gh` owns authentication.
- Do not ingest PR bodies, comments, CI logs or private session transcripts in
  the first slice. Fetch only the metadata needed for integration decisions.
- Fixtures use synthetic repositories, SHAs, users, PRs and check names.

## Delivery plan

### Slice 1 — plugin seam and selected-Agent vertical slice

- Implement the manifest, loader, registry and `code-host` plugin capability
  from the [plugin-system plan](observatory-plugin-system.md).
- Add `AgentRepositoryStatusReader`, normalized types and typed errors.
- Deepen the existing workspace Git inspection to provide repository identity,
  HEAD, dirty state, integration base and ahead/behind evidence while retaining
  the bounded diff.
- Add the synthetic code-host plugin and built-in GitHub `gh` plugin.
- Add one narrow loopback endpoint keyed only by Agent ID.
- Render the Repository inspector section and explicit degraded states.
- Prove same-repository PR, no PR, dirty worktree, unpublished commits,
  detached HEAD, ambiguous PR, missing auth and provider failure fixtures.
- Dogfood read-only against a live Herdr Agent with a known GitHub pull request.

### Slice 2 — portfolio and Closeout trust

- Add compact Agent and Goal repository summaries without changing Atlas
  topology.
- Enrich Results to review with deterministic integration warnings.
- Promote only failing checks, requested changes, conflicts and unpublished
  done work into explainable attention reasons.
- Add per-Agent refresh, remote TTL caching and bounded done-Agent prefetch.
- Exercise the 12-Goal/75-Agent mock portfolio without a GitHub request storm.

### Slice 3 — proposals and cross-Agent integration

- Add an optional agent command/skill that proposes a pull-request URL; verify
  it through the selected code-host plugin before confirmation.
- Add cross-Agent file overlap, branch divergence and shared integration-base
  evidence.
- Evaluate a supporting Git lens only after inspector and Closeout task tests
  show the evidence is useful.
- Consider persisted evidence history only when catch-up requirements prove the
  transient snapshot insufficient.

## Acceptance

The first two slices are ready when:

- every displayed pull-request association is explainable by repository and
  branch/commit evidence;
- a done Agent with local-only work, failing checks, requested changes or a
  conflict is visibly not integration-ready;
- GitHub absence or failure never hides local Git evidence or changes semantic
  state;
- ordinary host polling performs no remote GitHub lookup;
- the browser cannot choose a path, repository or pull request to inspect;
- synthetic and plugin contract tests cover correlation, ambiguity,
  degradation and cache invalidation; and
- live read-only dogfood can move from Agent to checkout diff to confirmed PR
  and back without losing Atlas context.

## Non-goals

- GitHub write actions, automatic merge or automatic Goal completion.
- Repositories, worktrees, branches, commits or PRs as default durable nodes.
- A plugin marketplace, automatic installation or daemon. Explicitly configured
  local plugin loading is in scope.
- GitHub Actions log ingestion or arbitrary PR/comment ingestion.
- Transcript parsing to discover pull-request URLs.
- Production GitLab or Bitbucket plugins in the first slice; the plugin contract
  and external example must make them contributable without core edits.
- Cross-Agent conflict prediction in the selected-Agent vertical slice.
