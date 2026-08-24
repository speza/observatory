import { describe, expect, test } from "bun:test";
import { selectionChangeForContextAction } from "./context-menu.ts";

describe("context-menu selection semantics", () => {
  test("keeps the primary selection while an empty menu is acted on", () => {
    expect(selectionChangeForContextAction("empty", undefined)).toEqual({ kind: "preserve" });
  });

  test("promotes a clicked goal or agent only when its action is chosen", () => {
    const target = { type: "agent" as const, id: "agent-1" };

    expect(selectionChangeForContextAction("selection", target)).toEqual({
      kind: "select",
      target,
    });
  });

  test("clears the selection when an inbox action is chosen", () => {
    expect(selectionChangeForContextAction("inbox", undefined)).toEqual({ kind: "clear" });
  });
});
