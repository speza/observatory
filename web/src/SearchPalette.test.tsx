import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SearchResult } from "../../src/projection/types.ts";
import { hostSnapshot, makeUniverse } from "../../src/universe/test-support.ts";
import { SearchPalette, searchPaletteKeyAction, searchResultAction } from "./SearchPalette.tsx";

const fixture = makeUniverse();
fixture.universe.execute({ type: "CreateGoal", id: "goal-a", title: "Atlas search" });
fixture.universe.reconcile(
  hostSnapshot([
    {
      nativeId: "native-a",
      displayName: "Mapping agent",
      runtimeState: "working",
      runtimeStateSource: "test",
      hostLocator: "test:native-a",
      observedAt: fixture.clock.now(),
    },
    {
      nativeId: "native-b",
      displayName: "Unassigned agent",
      runtimeState: "idle",
      runtimeStateSource: "test",
      hostLocator: "test:native-b",
      observedAt: fixture.clock.now(),
    },
  ]),
);
fixture.universe.execute({ type: "AssignAgent", agentId: "agent-1", goalId: "goal-a" });
const projection = fixture.universe.project({ kind: "universe-map", now: fixture.clock.now() });
if (projection.kind !== "universe-map") throw new Error("Expected map projection.");

const results: readonly SearchResult[] = [
  {
    type: "goal",
    id: "goal-a",
    label: "Atlas search",
    context: "goal metadata",
    status: "active",
  },
  {
    type: "agent",
    id: "agent-1",
    label: "Mapping agent",
    context: "agent · Understand concurrent work",
    status: "working",
    goalId: "goal-a",
  },
];

describe("SearchPalette", () => {
  test("renders an accessible result list with owning Goal context", () => {
    const markup = renderToStaticMarkup(
      <SearchPalette
        loading={false}
        onActivate={() => {}}
        onClose={() => {}}
        onQueryChange={() => {}}
        projection={projection}
        query="atlas"
        results={results}
      />,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("agent · Understand concurrent work");
    expect(markup).toContain("↵ focus in Atlas");
    expect(markup).toContain("search-palette-backdrop");
  });

  test("wraps traversal and activates or closes from the keyboard", () => {
    expect(searchPaletteKeyAction("ArrowDown", 1, 2)).toEqual({ type: "select", index: 0 });
    expect(searchPaletteKeyAction("ArrowUp", 0, 2)).toEqual({ type: "select", index: 1 });
    expect(searchPaletteKeyAction("Home", 1, 2)).toEqual({ type: "select", index: 0 });
    expect(searchPaletteKeyAction("End", 0, 2)).toEqual({ type: "select", index: 1 });
    expect(searchPaletteKeyAction("Enter", 1, 2)).toEqual({ type: "activate", index: 1 });
    expect(searchPaletteKeyAction("Escape", 1, 2)).toEqual({ type: "close" });
    expect(searchPaletteKeyAction("Enter", 0, 0)).toEqual({ type: "none" });
  });

  test("describes the projection-aware activation destination", () => {
    const unassigned: SearchResult = {
      type: "agent",
      id: "agent-2",
      label: "Unassigned agent",
      context: "unassigned agent",
      status: "idle",
    };
    const hidden: SearchResult = {
      type: "agent",
      id: "archived-agent",
      label: "Archived agent",
      context: "agent · Archived Goal",
      status: "working",
      goalId: "archived-goal",
    };
    expect(searchResultAction(results[0]!, projection)).toBe("focus");
    expect(searchResultAction(results[1]!, projection)).toBe("focus");
    expect(searchResultAction(unassigned, projection)).toBe("inbox");
    expect(searchResultAction(hidden, projection)).toBe("inspect");

    const renderAction = (result: SearchResult) =>
      renderToStaticMarkup(
        <SearchPalette
          loading={false}
          onActivate={() => {}}
          onClose={() => {}}
          onQueryChange={() => {}}
          projection={projection}
          query="atlas"
          results={[result]}
        />,
      );

    expect(renderAction(results[0]!)).toContain("↵ focus in Atlas");
    expect(renderAction(unassigned)).toContain("↵ open in Inbox");
    expect(renderAction(hidden)).toContain("↵ open in Inspector");
  });
});
