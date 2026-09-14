import { describe, expect, test } from "bun:test";
import {
  extendAgentSelection,
  isBatchAgentSelection,
  noSelection,
  onlySelection,
  pruneSelection,
  selectAgentSet,
  selectedAgentIds,
  selectionIntent,
  toggleAgentSelection,
  type SelectionModel,
} from "./selection.ts";

const agent = (id: string) => ({ type: "agent" as const, id });
const order = ["a", "b", "c", "d"];

describe("selection intent", () => {
  test("distinguishes plain, additive and range clicks", () => {
    expect(selectionIntent({ metaKey: false, ctrlKey: false, shiftKey: false })).toEqual({
      additive: false,
      range: false,
    });
    expect(selectionIntent({ metaKey: true, ctrlKey: false, shiftKey: false })).toEqual({
      additive: true,
      range: false,
    });
    expect(selectionIntent({ metaKey: false, ctrlKey: true, shiftKey: false })).toEqual({
      additive: true,
      range: false,
    });
    expect(selectionIntent({ metaKey: false, ctrlKey: false, shiftKey: true })).toEqual({
      additive: false,
      range: true,
    });
  });

  test("treats additive plus shift as additive so a range never toggles", () => {
    expect(selectionIntent({ metaKey: true, ctrlKey: false, shiftKey: true })).toEqual({
      additive: true,
      range: false,
    });
  });
});

describe("onlySelection", () => {
  test("collapses a batch to the clicked Agent and anchors it", () => {
    const batch = selectAgentSet(["a", "b", "c"]);
    expect(onlySelection(agent("b"))).toEqual({
      subject: agent("b"),
      agentIds: new Set(["b"]),
      anchor: "b",
    });
    expect(isBatchAgentSelection(batch)).toBe(true);
  });

  test("carries no Agent ids for Goal and discovered-execution subjects", () => {
    expect(onlySelection({ type: "goal", id: "g1" })).toEqual({
      subject: { type: "goal", id: "g1" },
      agentIds: new Set(),
    });
    expect(onlySelection({ type: "discovered-execution", id: "h1" }).agentIds.size).toBe(0);
  });
});

describe("toggleAgentSelection", () => {
  test("adds an Agent and keeps the first anchor for later ranges", () => {
    const first = toggleAgentSelection(noSelection, "b");
    expect(first).toEqual({ subject: agent("b"), agentIds: new Set(["b"]), anchor: "b" });
    const second = toggleAgentSelection(first, "d");
    expect(selectedAgentIds(second)).toEqual(["b", "d"]);
    expect(second.anchor).toBe("b");
    expect(second.subject).toEqual(agent("d"));
  });

  test("removes an Agent and falls back to the anchor as subject", () => {
    const batch = selectAgentSet(["a", "b", "c"]);
    const removed = toggleAgentSelection(batch, "c");
    expect(selectedAgentIds(removed)).toEqual(["a", "b"]);
    expect(removed.subject).toEqual(agent("a"));
  });

  test("clears the selection when the last Agent is removed", () => {
    expect(toggleAgentSelection(onlySelection(agent("a")), "a")).toEqual(noSelection);
  });

  test("never leaves a Goal subject carrying Agent ids", () => {
    const toggled = toggleAgentSelection(onlySelection({ type: "goal", id: "g1" }), "a");
    expect(toggled.agentIds).toEqual(new Set(["a"]));
    expect(toggled.subject).toEqual(agent("a"));
  });
});

describe("extendAgentSelection", () => {
  test("replaces the selection with the range between anchor and target", () => {
    const anchored = toggleAgentSelection(noSelection, "b");
    const extended = extendAgentSelection(anchored, "d", order);
    expect(selectedAgentIds(extended)).toEqual(["b", "c", "d"]);
    expect(extended.anchor).toBe("b");
    expect(extended.subject).toEqual(agent("d"));
  });

  test("extends backwards when the target precedes the anchor", () => {
    const anchored = selectAgentSet(["c"]);
    expect(selectedAgentIds(extendAgentSelection(anchored, "a", order))).toEqual(["a", "b", "c"]);
  });

  test("recomputes from the same anchor on repeated extensions", () => {
    const anchored = selectAgentSet(["a"]);
    const wide = extendAgentSelection(anchored, "d", order);
    const narrow = extendAgentSelection(wide, "b", order);
    expect(selectedAgentIds(narrow)).toEqual(["a", "b"]);
    expect(narrow.anchor).toBe("a");
  });

  test("collapses to one Agent when the anchor reappears after a reorder", () => {
    const orphan: SelectionModel = { subject: agent("c"), agentIds: new Set(["c"]) };
    expect(extendAgentSelection(orphan, "b", ["x", "y"]).agentIds).toEqual(new Set(["b"]));
  });
});

describe("selectAgentSet", () => {
  test("dedupes ids and ignores an out-of-set subject", () => {
    const selected = selectAgentSet(["a", "a", "b"], "z");
    expect(selectedAgentIds(selected)).toEqual(["a", "b"]);
    expect(selected.subject).toEqual(agent("a"));
  });

  test("keeps an in-set subject as the inspector subject", () => {
    expect(selectAgentSet(["a", "b"], "b").subject).toEqual(agent("b"));
  });

  test("an empty set clears the selection", () => {
    expect(selectAgentSet([])).toEqual(noSelection);
  });
});

describe("pruneSelection", () => {
  test("drops Agents that no longer exist", () => {
    const batch = selectAgentSet(["a", "b", "c"]);
    const pruned = pruneSelection(batch, new Set(["a", "c"]));
    expect(selectedAgentIds(pruned)).toEqual(["a", "c"]);
    expect(pruned.subject).toEqual(agent("a"));
  });

  test("clears the selection when the subject Agent disappeared", () => {
    expect(pruneSelection(selectAgentSet(["a", "b"]), new Set(["b"]))).toEqual(noSelection);
  });

  test("returns the same model when nothing changed", () => {
    const batch = selectAgentSet(["a", "b"]);
    expect(pruneSelection(batch, new Set(["a", "b", "c"]))).toBe(batch);
  });

  test("keeps a Goal subject while dropping any stale Agent ids", () => {
    const goalSubject = onlySelection({ type: "goal", id: "g1" });
    expect(pruneSelection(goalSubject, new Set())).toBe(goalSubject);
  });
});
