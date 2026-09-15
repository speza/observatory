import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { boundWebTerminalDimensions, WEB_TERMINAL_DIMENSION_LIMITS } from "./protocol/index.ts";
import { PortfolioResponseSchema } from "./protocol/views.ts";
import { projectPortfolio } from "./portfolio.ts";
import {
  admitObservedConversationsAndReconcile,
  hostSnapshot,
  makeUniverse,
} from "../universe/test-support.ts";

describe("web terminal dimensions", () => {
  test("bounds massive and tiny viewports to the shared terminal contract", () => {
    expect(boundWebTerminalDimensions({ columns: 20_000, rows: 8_000 })).toEqual({
      columns: WEB_TERMINAL_DIMENSION_LIMITS.maxColumns,
      rows: WEB_TERMINAL_DIMENSION_LIMITS.maxRows,
    });
    expect(boundWebTerminalDimensions({ columns: 0, rows: 0 })).toEqual({
      columns: WEB_TERMINAL_DIMENSION_LIMITS.minColumns,
      rows: WEB_TERMINAL_DIMENSION_LIMITS.minRows,
    });
  });
});

describe("execution presentation wire contract", () => {
  test("carries safe group, immediate context, and individual labels", () => {
    const { universe, clock } = makeUniverse();
    admitObservedConversationsAndReconcile(
      universe,
      hostSnapshot([
        {
          nativeId: "pane-simulation",
          displayName: "provider title",
          runtimeState: "working",
          runtimeStateSource: "fixture",
          observedAt: clock.now(),
          provider: "codex",
          executionContainer: { id: "opaque-group", label: "frontier" },
          executionContext: { id: "opaque-context", label: "simulation-pass" },
          executionLabel: "sim_progression",
          hostLocator: "opaque:pane-simulation",
        },
      ]),
    );
    const response = projectPortfolio(universe, clock.now());
    if (!response) throw new Error("portfolio projection was not produced");
    const decoded = Schema.decodeUnknownSync(PortfolioResponseSchema)(response);
    const agent = decoded.commandCentre.unassigned[0];
    expect(agent?.executionPresentation).toEqual({
      group: "frontier",
      context: "simulation-pass",
      label: "sim_progression",
    });
    expect(JSON.stringify(decoded)).not.toContain("opaque-group");
    expect(JSON.stringify(decoded)).not.toContain("opaque-context");
  });
});
