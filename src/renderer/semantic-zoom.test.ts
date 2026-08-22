import { describe, expect, test } from "bun:test";
import {
  goalLabelBudget,
  isAtLeast,
  nextSemanticZoom,
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

  test("makes focused lenses detailed without moving nodes", () => {
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
    ).toBe("context");
    expect(
      semanticZoomLevel({
        lens: "goal",
        preference: "overview",
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

  test("distinguishes current attention from stale host state", () => {
    expect(sessionMarker("live", "blocked")).toBe("!");
    expect(sessionMarker("live", "waiting")).toBe("!");
    expect(sessionMarker("stale", "blocked")).toBe("?");
    expect(sessionMarker("live", "idle")).toBe("·");
    expect(sessionMarker("live", "working", 0)).toBe("◐");
    expect(sessionMarker("live", "working", 0.6)).toBe("◓");
    expect(sessionMarker("live", "unknown")).toBe("?");
  });
});
