# Agent repository status and code-host plugins

Status: selected-Agent repository, pull-request and working-tree evidence implemented
Updated: 2026-09-02

Depends on:

- [Goal-centred agent orchestration map](../design/agent-orchestration-map.md)
- [Technical architecture](../design/technical-architecture.md)
- [Plugin architecture](../design/plugin-architecture.md)
- [Plugin system](observatory-plugin-system.md)
- [Feature roadmap](observatory-feature-roadmap.md)

## Decision

Observatory joins trusted Agent workspace metadata, bounded local Git facts and
optional code-host facts into one selected-Agent repository snapshot. This helps
the operator evaluate work without making repositories, branches, pull requests
or checks part of the durable organisational topology.

Runtime `done` is never integration readiness. Repository evidence supports a
human decision; it does not complete a Goal, accept a result or merge code.

## Interface

`AgentRepositoryStatusReader` accepts an Observatory Agent ID and optional
refresh intent. It returns a bounded snapshot with:

- availability and freshness;
- repository identity and current branch/HEAD;
- dirty, staged and untracked state;
- ahead/behind or unpublished-work evidence where available;
- zero, one or ambiguous associated pull requests;
- review, check, mergeability and conflict facts contributed by a code-host
  plugin; and
- explicit diagnostics for partial or unavailable evidence.

The browser cannot provide a filesystem path, repository name, remote URL or
pull-request number. The server resolves worktree context from accepted Agent
metadata.

## Ownership

### Repository reader

The deep repository module owns:

1. trusted Agent-to-worktree resolution;
2. bounded local Git commands;
3. credential-free remote normalisation;
4. provider selection through the plugin registry;
5. conservative pull-request correlation;
6. cache and refresh policy; and
7. deterministic failure and ambiguity semantics.

Callers receive one snapshot rather than coordinating Git and provider facts
themselves.

### Code-host plugin

A `code-host` plugin owns provider authentication and read-only remote queries.
The built-in GitHub implementation uses the user's `gh` installation and
returns provider-neutral pull-request/check facts. Observatory does not read or
store GitHub tokens.

Built-in, synthetic and external packages use the same plugin manifest and
capability interface. Disabling or breaking a plugin leaves local Git evidence
and trusted Universe state intact.

### Workspace diff reader

Working-tree review is a separate bounded read-only interface. The selected
Agent ID resolves the trusted worktree server-side. Diff output, file count,
file size and untracked-file reads are bounded before projection to the browser.

## Correlation rules

Pull-request association must be explainable by repository plus branch or commit
evidence.

- One exact candidate may be presented as associated.
- Multiple plausible candidates remain ambiguous and are shown as candidates.
- A repository-name or title similarity is insufficient.
- Missing provider data never hides local Git state.
- A remote URL is normalised and stripped of credentials before storage,
  projection or diagnostics.

Observatory does not parse transcripts, prompts, PR bodies or comments to guess
association.

## Freshness and cost

Local Git inspection is on demand for the selected Agent. Remote provider facts
use a short bounded cache and explicit refresh. Ordinary host reconciliation
does not trigger code-host calls.

The interface reports observation time and partial/unavailable state. A stale
last-known successful response is not silently presented as fresh. Expensive
portfolio-wide polling is out of scope until a measured workflow justifies it.

## Verification semantics

The repository module can explain conditions such as:

- local uncommitted or untracked work;
- commits not published to the integration base;
- no associated pull request;
- ambiguous pull-request association;
- failing or pending checks;
- requested changes;
- merge conflicts or unknown mergeability; and
- provider/authentication unavailability.

These are evidence and warnings, not accepted semantic state. Attention may use
only deterministic, explainable conditions and must preserve uncertainty.

## Failure behaviour

- Missing worktree: return not-applicable or unavailable with explanation.
- Non-Git directory: retain Agent state and report not-applicable.
- Git command failure or bounded-output truncation: return partial/unavailable;
  never report clean.
- Missing or disabled provider plugin: return local facts plus explicit provider
  unavailability.
- Authentication, rate-limit or network failure: preserve local facts and map
  the provider failure without raw stderr or credentials.
- Ambiguous provider results: retain every bounded candidate and choose none.
- Malformed provider output: reject the observation and preserve trusted state.

## Security and privacy

- Commands use structured argument arrays without shell interpolation.
- Browser requests are keyed by trusted Agent IDs.
- Output, diagnostics, file count and content size are bounded.
- Credentials are removed from remote URLs.
- Provider CLI authentication remains provider-owned.
- PR bodies, comments, CI logs, arbitrary repository files and transcripts are
  not ingested.
- Fixtures use synthetic repositories, users, commits, pull requests and checks.

## Verification

The implemented path is covered by:

- local reader tests over disposable Git repositories;
- credential-removal and remote-normalisation tests;
- ambiguity, no-PR and provider-failure fixtures;
- shared synthetic and GitHub plugin contract tests;
- browser gateway and repository inspector tests; and
- bounded working-tree diff tests, including unsafe and omitted untracked files.

## Remaining work

- Add cross-Agent overlap, divergence and integration-risk evidence only through
  a typed, explainable interface.
- Decide whether repository-derived warnings should enter Needs you from
  realistic supervision evidence.
- Consider another code-host adapter only as contribution proof; do not broaden
  core types speculatively.
- Keep provider writes, automatic merge and automatic Goal completion out of
  this module.
