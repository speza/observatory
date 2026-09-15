import { describe, expect, test } from "bun:test";
import { presentExecution } from "./executionPresentation.ts";

describe("execution presentation", () => {
  test("keeps a live label primary when it equals the durable fallback name", () => {
    for (const displayNameSource of ["provider", "fallback"] as const) {
      expect(
        presentExecution({
          displayName: "same execution",
          displayNameSource,
          executionPresentation: {
            label: "same execution",
            context: "frontier",
          },
        }),
      ).toEqual({
        primaryLabel: "same execution",
        secondaryContext: "frontier",
      });
    }
  });

  test("keeps a distinct group for a human-named Agent", () => {
    expect(
      presentExecution({
        displayName: "Accepted release",
        displayNameSource: "human",
        workspaceLabel: "frontier",
        executionPresentation: {
          group: "frontier",
          context: "release",
          label: "release-runner",
        },
      }),
    ).toEqual({
      primaryLabel: "Accepted release",
      secondaryContext: "release-runner · release · frontier",
    });
  });

  test("does not repeat a group already present in the human Agent context breadcrumb", () => {
    expect(
      presentExecution({
        displayName: "Accepted release",
        displayNameSource: "human",
        workspaceLabel: "frontier",
        executionPresentation: {
          group: "frontier",
          context: "frontier · release",
          label: "release-runner",
        },
      }),
    ).toEqual({
      primaryLabel: "Accepted release",
      secondaryContext: "release-runner · frontier · release",
    });
  });

  test("uses a named tab breadcrumb as discovered execution context, not an individual label", () => {
    expect(
      presentExecution({
        displayName: "release",
        executionPresentation: {
          group: "frontier",
          context: "frontier · release",
        },
      }),
    ).toEqual({ primaryLabel: "frontier · release" });
  });

  test("keeps context bounded while preserving its leading breadcrumb", () => {
    const context = presentExecution({
      displayName: "execution",
      executionPresentation: {
        group: "frontier",
        context: `frontier · ${"release-".repeat(80)}`,
      },
    }).primaryLabel;
    expect(context.startsWith("frontier · release-")).toBe(true);
    expect(context.length).toBeLessThanOrEqual(240);
  });
});
