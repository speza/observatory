import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostAgentObservation } from "../../src/hosts/types.ts";
import type { CloseoutProjection } from "../../src/projection/types.ts";
import { hostSnapshot, makeUniverse } from "../../src/universe/test-support.ts";
import { CloseoutPanel } from "./CloseoutPanel.tsx";

const observation = (
  nativeId: string,
  displayName: string,
  runtimeState: HostAgentObservation["runtimeState"],
): HostAgentObservation => ({
  nativeId,
  displayName,
  runtimeState,
  runtimeStateSource: "closeout-panel-test",
  observedAt: 1_000_000,
  hostLocator: `test:${nativeId}`,
});

describe("CloseoutPanel", () => {
  test("keeps reported results distinct from Agents ended in the host", () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(
      hostSnapshot([
        observation("done", "Review me", "done"),
        observation("ended", "Clear me", "idle"),
      ]),
    );
    fixture.clock.value += 1_000;
    fixture.universe.reconcile(hostSnapshot([observation("done", "Review me", "done")]));
    const projected = fixture.universe.project({ kind: "closeout", now: fixture.clock.now() });
    if (projected.kind !== "closeout") throw new Error("Expected closeout projection.");

    const markup = renderToStaticMarkup(
      <CloseoutPanel
        onArchive={async () => true}
        onClose={() => {}}
        onCloseAndArchive={async () => true}
        onReview={() => {}}
        onSelect={() => {}}
        pending={false}
        projection={projected satisfies CloseoutProjection}
        repositoryEvidence={new Map()}
      />,
    );

    expect(markup).toContain("Results to review");
    expect(markup).toContain("Review me");
    expect(markup).toContain("reported done");
    expect(markup).toContain("Ended externally");
    expect(markup).toContain("Clear me");
    expect(markup).toContain("Close &amp; archive");
  });

  test("shows accessible warnings before closeout actions and keeps no PR informational", () => {
    const fixture = makeUniverse();
    fixture.universe.reconcile(hostSnapshot([observation("done", "Risky result", "done")]));
    const projected = fixture.universe.project({ kind: "closeout", now: fixture.clock.now() });
    if (projected.kind !== "closeout") throw new Error("Expected closeout projection.");
    const agent = projected.results[0];
    if (!agent) throw new Error("Expected a done Agent.");
    const render = (diagnostics: readonly string[], withPullRequest: boolean): string =>
      renderToStaticMarkup(
        <CloseoutPanel
          onArchive={async () => true}
          onClose={() => {}}
          onCloseAndArchive={async () => true}
          onReview={() => {}}
          onSelect={() => {}}
          pending={false}
          projection={projected}
          repositoryEvidence={
            new Map([
              [
                agent.id,
                {
                  state: "ready" as const,
                  snapshot: {
                    kind: "agent-repository-status" as const,
                    agentId: agent.id,
                    status: "complete" as const,
                    observedAt: 1,
                    diagnostics,
                    pullRequests: withPullRequest
                      ? [
                          {
                            providerId: "synthetic",
                            repository: {
                              host: "example.test",
                              owner: "observatory",
                              name: "synthetic",
                            },
                            number: 42,
                            url: "https://example.test/pull/42",
                            title: "Risky result",
                            state: "open" as const,
                            draft: false,
                            baseBranch: "main",
                            headBranch: "result",
                            head: "remote-head",
                            checks: "failing" as const,
                            review: "changes-requested" as const,
                            mergeability: "conflicting" as const,
                            association: "confirmed" as const,
                            headSync: "local-ahead" as const,
                          },
                        ]
                      : [],
                    providerCached: true,
                    plugins: [],
                  },
                },
              ],
            ])
          }
        />,
      );

    const warningMarkup = render([], true);
    expect(warningMarkup).toContain('aria-label="Integration warnings for Risky result"');
    expect(warningMarkup).toContain("Local commits are absent from pull request #42.");
    expect(warningMarkup).toContain("Pull request #42 has failing checks.");
    expect(warningMarkup.indexOf("failing checks")).toBeLessThan(
      warningMarkup.indexOf("Close &amp; archive"),
    );

    const noPullRequestMarkup = render(
      ["No pull request found for this repository and branch."],
      false,
    );
    expect(noPullRequestMarkup).toContain("No pull request found; a pull request is not required.");
    expect(noPullRequestMarkup).not.toContain("Integration warnings for Risky result");
  });
});
