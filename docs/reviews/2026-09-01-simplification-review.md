# Observatory simplification review

Status: implemented; decision composition, Inspector routing, Atlas/Ledger alignment and Goal-level Catch Up complete

Date: 2026-09-01

Scope: current local web product after the provider-native observation and Catch
Up changes, exercised against a fresh deterministic 12-Goal, 75-Agent portfolio

## Verdict

Observatory has the right pieces but currently exposes too many pieces of its
evidence model as separate operator workflows. The result is not primarily
visual clutter. It is semantic duplication:

- Attention, Closeout and the Inspector each describe work that may need a
  decision, but use different candidate rules and routes to action;
- Atlas cards show provider-aware decision context while Ledger rows fall back
  to runtime state;
- Catch Up correctly separates accepted changes from provider observations but
  still asks the operator to reconstruct meaning from a transition feed; and
- counts sometimes describe claims or transitions and sometimes describe
  affected Agents, so the same label does not retain one meaning.

The next product pass should not add another projection or observation kind. It
should make the current evidence converge on one operator loop:

```text
Return -> understand -> choose -> inspect -> decide
```

The smallest coherent product is:

```text
Catch Up
   -> Needs you
      -> Atlas / Ledger
         -> Inspector
            -> Terminal / Review changes

Inbox remains a narrow organisation queue.
```

Closeout should stop being a separate top-level destination. Its host-safe
operations and coordinator remain valuable implementation; its candidates and
actions should appear in the same decision workflow as other work needing the
operator.

## Method

The review used a fresh database and the maintained mock path:

```sh
AO_WEB_PORT=4320 \
AO_HOST=mock \
AO_MOCK_SCENARIO=portfolio \
AO_MOCK_SEED=portfolio \
AO_DB_PATH=/tmp/ao-simplification-audit.sqlite \
bun run src/web/main.ts
```

The product was exercised at 1344 x 1824 through:

1. the all-System overview;
2. first-run Catch Up;
3. acknowledgement followed by mock scenario transitions;
4. Attention at portfolio and System scope;
5. selection into the Agent Inspector;
6. Atlas and Ledger comparison; and
7. Closeout into workspace review.

The examples below use only synthetic fixture names.

## Product contract

Each maintained surface should have one job.

| Surface                   | One question                                           | Rule                                                                                                    |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Catch Up                  | What changed my understanding while I was away?        | Summarise changes since an explicit checkpoint; do not become a second current-work queue.              |
| Needs you                 | Where is my judgment useful now?                       | One item per affected subject, with all supporting and conflicting claims composed beneath it.          |
| Atlas                     | Where does this work belong?                           | Preserve stable geography and selection; show only decision-relevant current context.                   |
| Ledger                    | What can I compare precisely?                          | Present the same meaning and ordering as Atlas in a denser form.                                        |
| Inbox                     | Which discovered work has no accepted home?            | Contain only unassigned or proposed work; leave immediately after assignment or dismissal.              |
| Inspector                 | What do I know, why does it matter, and what can I do? | Compose accepted state, actionable evidence, supporting evidence and available actions for one subject. |
| Terminal / Review changes | What detail do I need to investigate or intervene?     | Remain focused tools reached from the Inspector or a direct action.                                     |

This removes the expectation that the operator knows whether a result came from
provider evidence, host runtime state, or the closeout projection before they
can choose the correct surface.

## Findings

### 1. Attention currently counts claims rather than work needing judgment

In the exercised portfolio, Attention showed two separate entries for the same
synthetic Agent, `Acceptance evidence`:

- Codex reported the response complete; and
- the mock host reported the Agent blocked.

Both facts are valuable. Two queue entries are not. They describe one subject
requiring one investigation, with conflicting or complementary evidence.

This also gives `Attention` more than one numerical meaning. The top-level count
is based on attention items, while Goal and System summaries count Agents whose
primary attention item requires human input. A new evidence source can
therefore increase the portfolio number without increasing the number of
Agents needing judgment.

**Decision:** the operator-facing unit is an affected subject, not an evidence
claim. Show one item per Agent or host. Retain every claim inside its explanation.

A useful item shape is conceptually:

```text
Acceptance evidence                         P2
Response ready for review
Also observed: host reports blocked
Validate a New Product Direction
```

This does not require collapsing evidence authority. It requires composing
claims for presentation.

### 2. Closeout and Attention split one decision domain by evidence source

Provider-reported response completion appears in Attention. Host-reported
runtime `done` appears in Closeout. The operator must know which source produced
“finished” before knowing where to look.

Closeout also combines two different jobs:

- review a reported result; and
- clean up Agents whose executions ended externally.

The former is a judgment workflow. The latter is lifecycle maintenance. The
current `Review` action opens a terminal and working-tree diff directly, while
selecting the identity opens the Inspector. This bypasses the one place that
should explain all evidence and actions before a consequential decision.

**Decision:** remove Closeout as a top-level product surface.

- Provider completion and runtime `done` both produce one `Review result`
  subject in Needs you.
- Ended-external Agents appear as lower-priority `Resolve ended Agent` subjects
  or a collapsed maintenance group.
- Selecting either opens the Inspector.
- The Inspector exposes `Review changes`, `Open terminal`, and the existing
  host-synchronised `Close & archive` action when valid.
- Batch cleanup may remain as a secondary action only if real use proves it is
  needed. It should not determine the primary information architecture.

The `agent-closeout` coordinator remains a deep module: deleting its panel does
not remove the host-before-archive correctness it provides.

### 3. Catch Up has the right authority split but the wrong unit of summary

The revised panel clearly distinguishes accepted changes from provider signals.
That is a strong improvement and should remain.

At first launch, however, the fresh portfolio presented 91 summarized accepted
items derived from 180 transitions. Most were mechanical setup facts such as
75 individual Agent assignments and 12 Goal updates. The screen accurately
reported history but did not help the operator understand a portfolio.

After acknowledgement, a scenario transition produced six summarized items:
four Agents returned live and two Agents moved from waiting or blocked to idle.
This was manageable, but it still described individual transitions rather than
what changed for their Goals.

The panel also displayed `6` accepted items while its footer displayed `12
accepted changes`. Internally this means six latest-per-target summaries over
12 raw transitions, but the interface calls both values “changes.” The operator
should not need to understand that distinction.

**Decision:** Catch Up should summarise by semantic subject, usually Goal.

For example:

```text
Establish Safe Extension Boundaries
2 Agents no longer need attention

Understand Concurrent Agent Work
4 previously uncertain Agents returned live
```

Recommended rules:

- Establish the initial imported or seeded state as a baseline, not unread work.
- Group related Agent transitions under their Goal.
- Lead with changes that alter a decision: needs input, result available,
  failure, uncertainty introduced or resolved.
- Collapse routine state movement and bulk organisation changes.
- Show provider requests and outcomes in the relevant Goal summary rather than
  a parallel feed when correlation exists.
- If raw transitions remain available, label them explicitly as transitions in
  a disclosure. Do not show two unlabeled interpretations of “changes.”

Catch Up remains historical. If an issue is still actionable, it links to the
same current Needs-you subject and Inspector rather than implementing separate
actions.

### 4. Atlas and Ledger do not currently present the same semantics

Atlas cards use enriched presentation and can say:

- `Observed: permission needed`;
- `Response ready for review`; or
- `Context pressure elevated`.

For the same Agents, Ledger rows show only `BLOCKED`, `WORKING` or `WAITING`.
The Ledger therefore cannot act as a dense alternative to Atlas: it loses the
provider evidence that made the Agent decision-relevant.

Conversely, most Atlas cards render `No current activity observed`. At portfolio
scale that repeated absence becomes visual noise. Unknown evidence is an
important fact in the Inspector, but it does not deserve the most prominent
line on every routine Agent card.

**Decision:** Atlas and Ledger share one Agent presentation model and ordering.

- Both show the same decision label when one exists.
- Both use the same one-per-Agent Needs-you state.
- Both preserve selection and Inspector context.
- Atlas adds geography; Ledger adds density and comparison.
- Routine Agents show identity and coarse state without repeating “No current
  activity observed.”

`agentCardPresentation.ts` is a promising start, but it is currently consumed
only by the Atlas path. The presentation rule should be shared, with layout-
specific truncation kept inside each renderer.

### 5. The Inspector exposes evidence but does not yet resolve the decision

The selected synthetic completed-response Agent showed:

- runtime `Working`;
- provider turn outcome `response completed`;
- repository evidence unavailable for its synthetic path; and
- actions for terminal and change review.

This is truthful, but the decision itself is not stated. The operator has to
infer why a `Working` Agent was selected from Attention. After review, there is
no coherent result-oriented next step in the main Inspector section. Lifecycle
actions are hidden in a separate disclosure.

**Decision:** lead the Agent Inspector with a decision summary, then evidence.

```text
REVIEW RESULT
Provider reports a completed response; accepted completion remains unset.
Repository evidence unavailable.

[Review changes] [Open terminal]
```

When host-safe closeout is valid, expose it after review as an explicit action.
Do not imply that closing an execution accepts the result or completes the Goal.
Goal completion remains a separate human command.

The four provider fields are useful diagnostic evidence, but unknown values do
not all need equal visual weight. Show observed claims first; place unsupported,
unknown and provenance detail in the technical disclosure unless uncertainty is
itself the reason for attention.

### 6. Inbox is already appropriately narrow

Inbox currently describes “work awaiting a home,” contains unassigned Agents,
and provides assignment to an active Goal. This is coherent with the durable
model.

**Decision:** keep and narrow, rather than merge.

- Do not add blocked, completed or uncertain assigned Agents.
- Add related-Agent adopt/dismiss proposals here only if they share the same
  organising decision.
- Keep evidence inspection in the Inspector.
- Consider `Unorganised` as a clearer label than `Inbox` only through user
  testing; no rename is needed now.

### 7. Secondary tools compete with the primary loop in the masthead

Conversation history is an important recovery lens, but it is visually placed
beside Find as a permanent global tool. New Agent, pending launches, historical
conversation adoption and resume are parts of one broader conversation-entry
workflow.

**Decision:** retain the capability but demote the destination.

A later simplification can place `Recover conversation` inside New Agent or a
small tools menu. This is not the first implementation slice because it does
not currently create conflicting semantic counts or decisions.

## Keep, narrow, merge, remove

| Current capability or surface    | Recommendation                         | Target                                                        |
| -------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Systems overview                 | Keep                                   | Portfolio orientation before entering a System.               |
| Atlas                            | Keep and narrow                        | Stable geography with decision-relevant Agent summaries.      |
| Ledger                           | Keep and align                         | Dense rendering of the same semantics as Atlas.               |
| Catch Up                         | Narrow                                 | Goal-level semantic summary since checkpoint.                 |
| Attention                        | Deepen and rename in the product model | One `Needs you` item per subject, composed from all evidence. |
| Inbox                            | Keep and narrow                        | Unassigned or adoptable work only.                            |
| Closeout panel                   | Remove as a top-level surface          | Merge candidates and actions into Needs you and Inspector.    |
| Closeout coordinator             | Keep                                   | Host-safe close-before-archive implementation.                |
| Inspector                        | Deepen                                 | Decision summary, evidence composition and available actions. |
| Provider activity on every card  | Demote                                 | Show only when decision-relevant; retain detail in Inspector. |
| Provider observation pipeline    | Keep, freeze vocabulary                | Validate four current kinds before expansion.                 |
| Terminal deck                    | Keep                                   | Direct intervention tool.                                     |
| Working-tree review              | Keep                                   | Read-only evidence tool.                                      |
| Conversation history             | Keep, later demote                     | Recovery action within conversation entry/tooling.            |
| Search                           | Keep                                   | Fast route to known context.                                  |
| Motion toggle and visual effects | Keep stable                            | Do not expand during simplification.                          |

## Semantic model for the interface

The implementation may retain more precise types, but the product should expose
three levels consistently:

1. **Accepted state** — durable human-authored or reconciled Observatory state.
2. **Actionable evidence** — fresh evidence that changes what the operator
   should decide now.
3. **Supporting or uncertain evidence** — context, provenance, conflicts and
   missing facts that calibrate trust.

One Agent can have many evidence claims but only one primary current decision.
The Inspector reveals the claims; queues and map summaries present the decision.
This is presentation composition, not semantic acceptance.

## Smallest first implementation slice

The first slice should fix the current decision loop without redesigning the
Universe or expanding the observation contract.

### Slice A: one decision item per Agent

1. Compose host and provider attention claims by Agent.
2. Choose one primary decision label using explicit deterministic precedence.
3. Retain all other claims as supporting explanations.
4. Make every Attention count mean the number of affected subjects.
5. Add contract tests for:
   - provider input plus host waiting;
   - provider completion plus host blocked;
   - provider completion plus runtime done;
   - context pressure plus otherwise routine work; and
   - host-wide uncertainty.

The intended precedence is decision-oriented, not source-authority-oriented:

```text
input required / failure
> result ready for review
> lifecycle inconsistency
> elevated risk or uncertainty
> routine state
```

Sources retain authority only over their own axes. Precedence selects the
operator action, not the truth.

### Slice B: route result review through the Inspector

1. Add runtime-done candidates to the composed Needs-you subjects.
2. Give the Agent Inspector a decision-summary section.
3. Keep `Review changes`, `Open terminal`, and valid close/archive actions there.
4. Remove the Closeout metric, shortcut and panel from the primary UI.
5. Preserve the closeout coordinator and command path.
6. Defer batch cleanup unless dogfooding demonstrates repeated need.

### Slice C: align Atlas and Ledger

1. Extract a shared semantic Agent presentation from enriched `AgentView`.
2. Render its decision label in both views.
3. Remove the repeated `No current activity observed` fallback from routine
   Atlas cards.
4. Verify that selecting the same Agent in either view opens the same Inspector
   without changing System scope unexpectedly.

These three changes create one coherent current-work loop. Catch Up synthesis
should follow as a separate slice because its historical grouping rules need
design and fixture work of their own.

## Code implications

No implementation change is recommended merely to reduce line count. The
following code pressure is evidence of product seams that should deepen after
the product decisions above:

- `web/src/App.tsx` owns five side-panel modes and more than 1,100 lines of
  orchestration. Removing the Closeout mode and converging selection routes
  should reduce state and keyboard branching before any extraction is
  attempted.
- `src/agent-observations/projection.ts` has projection-specific enrichment for
  command centre, map, Catch Up and Inspector, while Closeout remains outside
  that enrichment path. This makes cross-surface semantic divergence easy. The
  observation projection module needs a smaller, coherent interface around
  composed Agent decisions, not another pass-through layer.
- `src/attention/attention.ts` emits claim-level items and the observation
  projection appends more claim-level items. A deeper composition module should
  own one-subject presentation and preserve its contributing claims internally.
- `web/src/CloseoutPanel.tsx` can be removed only after its useful evidence and
  actions have a home. The host lifecycle coordinator must not be flattened into
  React callbacks.
- `web/src/Ledger.tsx` currently reimplements Agent presentation from raw runtime
  fields. It should consume the same semantic presentation as Atlas.

Before changing the evidence-projection interface, design it twice and compare
alternatives for depth, locality and deterministic testing. Do not layer a new
`ActionQueueService` over the existing projections.

## Implementation outcome

The first implementation pass completed Slices A–C:

- host and provider claims now compose into one decision per Agent with
  supporting explanations;
- runtime results and confirmed ended executions enter Needs you;
- the standalone Closeout metric, shortcut, panel, browser projection payload
  and renderer-only evidence loader were removed;
- host-safe close and archive remains in the Agent Inspector through the
  existing coordinator;
- Atlas and Ledger now consume the same Agent presentation rule; and
- routine cards no longer repeat `No current activity observed`.

The mock portfolio now establishes its synthetic setup as the initial Catch Up
baseline. Catch Up groups Agent trajectories under their owning Goal, synthesises
attention resolution and uncertainty recovery from typed outcomes, places
correlated provider observations inside the same subject, and keeps raw
transitions in an explicitly labelled collapsed disclosure.

## Explicit non-goals for the simplification pass

- no new observation kinds;
- no transcript ingestion;
- no relationship graph;
- no second host;
- no new top-level surface;
- no visual redesign of the Atlas;
- no automatic acceptance, completion or archive;
- no generic event bus; and
- no refactor whose only evidence is fewer lines in one file.

## Evaluation gate

After the first three implementation slices, repeat the same fresh-portfolio
walkthrough and a real 24–48 hour dogfood return. The pass succeeds only if:

- every top-level count has one explainable unit;
- one Agent appears at most once in Needs you;
- provider-complete and runtime-done work use the same review route;
- Atlas and Ledger communicate the same reason an Agent matters;
- the operator reaches evidence and an available action without choosing an
  evidence-source-specific surface; and
- no trusted authority or uncertainty is lost by the simplification.

If these conditions hold, design Goal-level Catch Up synthesis next. If they do
not, do not broaden the product; simplify the current decision composition
again.
