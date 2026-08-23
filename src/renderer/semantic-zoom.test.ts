import { describe, expect, test } from "bun:test";
import {
  goalLabelBudget,
  isRecentlyDone,
  isAtLeast,
  nextSemanticZoom,
  perspectiveNodeScale,
  semanticZoomLevel,
  sessionLabelBudget,
  sessionMarker,
} from "./semantic-zoom.ts";

describe("semantic zoom", () => {
  test("cycles the three presentation levels", () => {
    expect(nextSemanticZoom("overview")).toBe("context");
    expect(nextSemanticZoom("context")).toBe("detail");
    expect(nextSemanticZoom("detail")).toBe("overview");
  });

  test("keeps focused lenses navigable at every label level", () => {
    expect(
      semanticZoomLevel({
        lens: "portfolio",
        preference: "overview",
      }),
    ).toBe("overview");
    expect(
      semanticZoomLevel({
        lens: "portfolio",
        preference: "overview",
        selected: true,
      }),
    ).toBe("detail");
    expect(
      semanticZoomLevel({
        lens: "goal",
        preference: "overview",
      }),
    ).toBe("overview");
    expect(
      semanticZoomLevel({
        lens: "goal",
        preference: "context",
      }),
    ).toBe("context");
    expect(
      semanticZoomLevel({
        lens: "inbox",
        preference: "detail",
      }),
    ).toBe("detail");
    expect(
      semanticZoomLevel({
        lens: "attention",
        preference: "detail",
        attention: true,
      }),
    ).toBe("detail");
  });

  test("allocates more label room as semantic detail increases", () => {
    expect(sessionLabelBudget("overview", 80, false)).toBeLessThan(
      sessionLabelBudget("context", 80, false),
    );
    expect(sessionLabelBudget("context", 80, false)).toBeLessThan(
      sessionLabelBudget("detail", 80, false),
    );
    expect(goalLabelBudget("detail", 140)).toBeGreaterThan(goalLabelBudget("overview", 140));
    expect(isAtLeast("detail", "context")).toBe(true);
    expect(isAtLeast("overview", "context")).toBe(false);
  });

  test("scales node geometry with camera zoom", () => {
    expect(perspectiveNodeScale(0.65)).toBeLessThan(perspectiveNodeScale(1));
    expect(perspectiveNodeScale(1)).toBeCloseTo(1);
    expect(perspectiveNodeScale(2.2)).toBeGreaterThan(perspectiveNodeScale(1));
  });

  test("distinguishes current attention from stale host state", () => {
    expect(sessionMarker("live", "blocked")).toBe("!");
    expect(sessionMarker("live", "waiting")).toBe("…");
    expect(sessionMarker("stale", "blocked")).toBe("?");
    expect(sessionMarker("live", "idle")).toBe("·");
    expect(sessionMarker("live", "done")).toBe("✓");
    expect(sessionMarker("live", "working", 0)).toBe("◐");
    expect(sessionMarker("live", "working", 0.6)).toBe("◓");
    expect(sessionMarker("live", "unknown")).toBe("?");
  });

  test("keeps a completed session in the review window", () => {
    expect(
      isRecentlyDone({ hostHealth: "live", runtimeState: "done", lastChangedAt: 90 }, 100),
    ).toBe(true);
    expect(
      isRecentlyDone(
        { hostHealth: "live", runtimeState: "done", lastChangedAt: 0 },
        30 * 60 * 1000 + 1,
      ),
    ).toBe(false);
    expect(
      isRecentlyDone({ hostHealth: "stale", runtimeState: "done", lastChangedAt: 90 }, 100),
    ).toBe(false);
    expect(
      isRecentlyDone({ hostHealth: "live", runtimeState: "idle", lastChangedAt: 90 }, 100),
    ).toBe(false);
  });
});
