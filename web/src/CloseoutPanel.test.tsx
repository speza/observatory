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
      />,
    );

    expect(markup).toContain("Results to review");
    expect(markup).toContain("Review me");
    expect(markup).toContain("reported done");
    expect(markup).toContain("Ended externally");
    expect(markup).toContain("Clear me");
    expect(markup).toContain("Close &amp; archive");
  });
});
