import { describe, expect, test } from "bun:test";
import {
  EMPTY_OPEN_FILE_TABS,
  isCurrentFileRequest,
  MAX_OPEN_FILE_TABS,
  readOpenFileTabs,
  reduceOpenFileTabs,
  reviewTabStorage,
  safeScrollPosition,
  tabPathForKey,
  writeOpenFileTabs,
  type OpenFileTabsState,
  type ReviewFileMode,
} from "./openFileTabs.ts";

const open = (
  state: OpenFileTabsState,
  path: string,
  preferredMode: ReviewFileMode = "source",
): OpenFileTabsState =>
  reduceOpenFileTabs(state, {
    type: "open",
    file: { path, fileId: `id:${path}`, change: "modified", contentKind: "text" },
    preferredMode,
  });

describe("open review file tabs", () => {
  test("bounds a large working set and evicts the least-recent inactive tab", () => {
    let state = EMPTY_OPEN_FILE_TABS;
    for (let index = 0; index < MAX_OPEN_FILE_TABS; index += 1)
      state = open(state, `src/file-${index}.ts`);

    state = reduceOpenFileTabs(state, { type: "activate", path: "src/file-0.ts" });
    state = open(state, "src/file-8.ts");

    expect(state.tabs).toHaveLength(MAX_OPEN_FILE_TABS);
    expect(state.tabs.map((tab) => tab.path)).toContain("src/file-0.ts");
    expect(state.tabs.map((tab) => tab.path)).not.toContain("src/file-1.ts");
    expect(state.activePath).toBe("src/file-8.ts");

    for (let index = 9; index < 100; index += 1) state = open(state, `src/file-${index}.ts`);
    expect(state.tabs).toHaveLength(MAX_OPEN_FILE_TABS);
    expect(new Set(state.tabs.map((tab) => tab.path)).size).toBe(MAX_OPEN_FILE_TABS);
    expect(state.activePath).toBe("src/file-99.ts");
  });

  test("falls forward, then backward, when the active tab closes", () => {
    let state = open(open(open(EMPTY_OPEN_FILE_TABS, "a.ts"), "b.ts"), "c.ts");
    state = reduceOpenFileTabs(state, { type: "activate", path: "b.ts" });
    state = reduceOpenFileTabs(state, { type: "close", path: "b.ts" });
    expect(state.activePath).toBe("c.ts");

    state = reduceOpenFileTabs(state, { type: "close", path: "c.ts" });
    expect(state.activePath).toBe("a.ts");
    state = reduceOpenFileTabs(state, { type: "close", path: "a.ts" });
    expect(state.activePath).toBeUndefined();
  });

  test("touches the active fallback before the next bounded eviction", () => {
    let state = EMPTY_OPEN_FILE_TABS;
    for (let index = 0; index < MAX_OPEN_FILE_TABS; index += 1)
      state = open(state, `src/file-${index}.ts`);
    state = reduceOpenFileTabs(state, { type: "activate", path: "src/file-2.ts" });
    state = reduceOpenFileTabs(state, { type: "close", path: "src/file-2.ts" });
    expect(state.activePath).toBe("src/file-3.ts");
    state = reduceOpenFileTabs(state, { type: "activate", path: "src/file-7.ts" });
    state = open(state, "src/file-8.ts");
    state = open(state, "src/file-9.ts");
    expect(state.tabs.map((tab) => tab.path)).toContain("src/file-3.ts");
    expect(state.tabs.map((tab) => tab.path)).not.toContain("src/file-0.ts");
  });

  test("traverses tabs with scoped WAI-ARIA keys without browser shortcuts", () => {
    const state = open(open(open(EMPTY_OPEN_FILE_TABS, "a.ts"), "b.ts"), "c.ts");
    expect(tabPathForKey(state, "b.ts", "ArrowRight")).toBe("c.ts");
    expect(tabPathForKey(state, "c.ts", "ArrowRight")).toBe("a.ts");
    expect(tabPathForKey(state, "a.ts", "ArrowLeft")).toBe("c.ts");
    expect(tabPathForKey(state, "b.ts", "Home")).toBe("a.ts");
    expect(tabPathForKey(state, "b.ts", "End")).toBe("c.ts");
    expect(tabPathForKey(state, "b.ts", "Tab")).toBeUndefined();
  });

  test("restores per-file modes and nearest safe scroll positions", () => {
    let state = open(EMPTY_OPEN_FILE_TABS, "src/review.ts", "source");
    state = reduceOpenFileTabs(state, {
      type: "save-scroll",
      path: "src/review.ts",
      mode: "source",
      top: 420,
      left: 35,
    });
    state = reduceOpenFileTabs(state, { type: "set-mode", mode: "diff" });
    expect(state.tabs[0]?.mode).toBe("diff");
    expect(state.tabs[0]?.scroll.diff).toBeUndefined();

    state = reduceOpenFileTabs(state, {
      type: "save-scroll",
      path: "src/review.ts",
      mode: "diff",
      top: 900,
      left: 80,
    });
    state = reduceOpenFileTabs(state, { type: "set-mode", mode: "source" });
    expect(state.tabs[0]?.scroll.source).toEqual({ top: 420, left: 35 });
    expect(safeScrollPosition(Number.POSITIVE_INFINITY, -4)).toEqual({ top: 0, left: 0 });

    state = open(state, "src/types.ts", "baseline");
    state = reduceOpenFileTabs(state, { type: "activate", path: "src/review.ts" });
    expect(state.tabs.find((tab) => tab.path === "src/review.ts")?.mode).toBe("source");
    expect(state.tabs.find((tab) => tab.path === "src/types.ts")?.mode).toBe("baseline");
  });

  test("keeps file-read failures scoped to their path and view", () => {
    let state = open(open(EMPTY_OPEN_FILE_TABS, "src/a.ts"), "src/b.ts");
    state = reduceOpenFileTabs(state, {
      type: "file-status",
      path: "src/a.ts",
      mode: "source",
      status: "unavailable",
      message: "Source read failed.",
    });
    expect(state.tabs.find((tab) => tab.path === "src/a.ts")?.viewState.source).toEqual({
      status: "unavailable",
      message: "Source read failed.",
    });
    expect(state.tabs.find((tab) => tab.path === "src/a.ts")?.availability).toBe("available");
    expect(state.tabs.find((tab) => tab.path === "src/a.ts")?.viewState.baseline).toBeUndefined();
    expect(state.tabs.find((tab) => tab.path === "src/b.ts")?.viewState).toEqual({});

    state = reduceOpenFileTabs(state, {
      type: "file-status",
      path: "src/a.ts",
      mode: "source",
      status: "available",
    });
    expect(state.tabs.find((tab) => tab.path === "src/a.ts")?.viewState).toEqual({});

    state = reduceOpenFileTabs(state, {
      type: "file-status",
      path: "src/a.ts",
      mode: "source",
      status: "stale",
      message: "Workspace changed.",
    });
    expect(state.tabs.every((tab) => tab.availability === "stale" && !tab.fileId)).toBeTrue();
  });

  test("rejects late responses after rapid switches or aborts", () => {
    const first = { nonce: Symbol() };
    const second = { nonce: Symbol() };
    expect(isCurrentFileRequest(second, first, false)).toBeFalse();
    expect(isCurrentFileRequest(second, second, true)).toBeFalse();
    expect(isCurrentFileRequest(second, second, false)).toBeTrue();
  });

  test("retains exact paths, follows unique renames, and marks missing paths honestly", () => {
    let state = open(open(open(EMPTY_OPEN_FILE_TABS, "src/keep.ts"), "src/old.ts"), "gone.ts");
    state = reduceOpenFileTabs(state, { type: "refresh-start" });
    expect(state.tabs.every((tab) => tab.availability === "stale" && !tab.fileId)).toBeTrue();

    state = reduceOpenFileTabs(state, {
      type: "reconcile",
      files: [
        { path: "src/keep.ts", fileId: "next-keep", change: "modified", contentKind: "text" },
        { path: "src/new.ts", fileId: "next-new", change: "renamed", contentKind: "text" },
      ],
      renames: [{ oldPath: "src/old.ts", path: "src/new.ts" }],
      absenceEvidence: "authoritative",
    });

    expect(state.tabs.find((tab) => tab.path === "src/keep.ts")?.fileId).toBe("next-keep");
    expect(state.tabs.find((tab) => tab.path === "src/new.ts")).toMatchObject({
      previousPath: "src/old.ts",
      availability: "available",
    });
    expect(state.tabs.find((tab) => tab.path === "gone.ts")?.availability).toBe("removed");
    expect(state.activePath).toBe("gone.ts");

    state = reduceOpenFileTabs(state, {
      type: "reconcile",
      files: [
        { path: "src/keep.ts", fileId: "same-keep", change: "modified" },
        { path: "src/new.ts", fileId: "same-new", change: "renamed" },
      ],
      renames: [{ oldPath: "src/old.ts", path: "src/new.ts" }],
      absenceEvidence: "authoritative",
    });
    expect(state.tabs.find((tab) => tab.path === "src/new.ts")?.previousPath).toBe("src/old.ts");

    state = reduceOpenFileTabs(state, {
      type: "reconcile",
      files: [
        { path: "src/keep.ts", fileId: "third-keep", change: "modified" },
        { path: "src/newer.ts", fileId: "third-new", change: "renamed" },
      ],
      renames: [{ oldPath: "src/old.ts", path: "src/newer.ts" }],
      absenceEvidence: "authoritative",
    });
    expect(state.tabs.find((tab) => tab.path === "src/newer.ts")).toMatchObject({
      previousPath: "src/old.ts",
      availability: "available",
    });
  });

  test("represents ambiguous renames and incomplete or unavailable files without relabeling", () => {
    let state = open(open(EMPTY_OPEN_FILE_TABS, "src/old.ts"), "src/not-indexed.ts");
    state = reduceOpenFileTabs(state, {
      type: "reconcile",
      files: [
        { path: "src/a.ts", fileId: "a", change: "renamed", contentKind: "binary" },
        { path: "src/b.ts", fileId: "b", change: "renamed", contentKind: "oversized" },
      ],
      renames: [
        { oldPath: "src/old.ts", path: "src/a.ts" },
        { oldPath: "src/old.ts", path: "src/b.ts" },
      ],
      absenceEvidence: "incomplete",
    });

    expect(state.tabs.find((tab) => tab.path === "src/old.ts")).toMatchObject({
      availability: "unavailable",
      message: expect.stringContaining("ambiguously"),
    });
    expect(state.tabs.find((tab) => tab.path === "src/not-indexed.ts")).toMatchObject({
      availability: "unavailable",
      message: expect.stringContaining("incomplete"),
    });

    state = open(open(state, "src/binary.dat"), "src/huge.ts");
    state = reduceOpenFileTabs(state, {
      type: "reconcile",
      files: [
        { path: "src/binary.dat", fileId: "binary", contentKind: "binary" },
        { path: "src/huge.ts", fileId: "huge", contentKind: "oversized" },
      ],
      renames: [],
      absenceEvidence: "authoritative",
    });
    expect(state.tabs.find((tab) => tab.path === "src/binary.dat")?.availability).toBe("binary");
    expect(state.tabs.find((tab) => tab.path === "src/huge.ts")?.availability).toBe("oversized");

    const unresolvedRename = reduceOpenFileTabs(open(EMPTY_OPEN_FILE_TABS, "src/old.ts"), {
      type: "reconcile",
      files: [],
      renames: [{ oldPath: "src/old.ts", path: "src/new.ts" }],
      absenceEvidence: "incomplete",
    });
    expect(unresolvedRename.tabs[0]).toMatchObject({
      path: "src/old.ts",
      availability: "unavailable",
      message: expect.stringContaining("renamed to src/new.ts"),
    });

    const unavailableIndex = reduceOpenFileTabs(open(EMPTY_OPEN_FILE_TABS, "src/keep.ts"), {
      type: "reconcile",
      files: [],
      renames: [],
      absenceEvidence: "unavailable",
    });
    expect(unavailableIndex.tabs[0]).toMatchObject({
      availability: "unavailable",
      message: expect.stringContaining("index is unavailable"),
    });
  });

  test("keeps an unchanged tab badge-free while unknown content remains readable", () => {
    const state = reduceOpenFileTabs(EMPTY_OPEN_FILE_TABS, {
      type: "open",
      file: { path: "src/pending.ts", fileId: "pending", contentKind: "unknown" },
      preferredMode: "source",
    });
    expect(state.tabs[0]?.change).toBeUndefined();
    expect(state.tabs[0]?.availability).toBe("available");
  });

  test("degrades safely when browser storage fails and never persists handles or contents", () => {
    const failing = {
      getItem: () => {
        throw new Error("privacy mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readOpenFileTabs(failing, "agent-1")).toEqual(EMPTY_OPEN_FILE_TABS);
    expect(() =>
      writeOpenFileTabs(failing, "agent-1", open(EMPTY_OPEN_FILE_TABS, "safe.ts")),
    ).not.toThrow();

    let encoded = "";
    const storage = {
      getItem: () => encoded,
      setItem: (_key: string, value: string) => {
        encoded = value;
      },
    };
    const state = open(EMPTY_OPEN_FILE_TABS, "src/safe.ts", "diff");
    writeOpenFileTabs(storage, "agent-1", state);
    expect(encoded).not.toContain("id:src/safe.ts");
    expect(encoded).not.toContain("content");
    expect(readOpenFileTabs(storage, "agent-1")).toMatchObject({
      activePath: "src/safe.ts",
      tabs: [{ path: "src/safe.ts", mode: "diff", availability: "stale" }],
    });

    encoded = JSON.stringify({
      version: 1,
      activePath: "/etc/passwd",
      tabs: [
        { path: "/etc/passwd", mode: "source", scroll: {} },
        { path: "../secret", mode: "source", scroll: {} },
      ],
    });
    expect(readOpenFileTabs(storage, "agent-1")).toEqual(EMPTY_OPEN_FILE_TABS);

    const blockedWindow = {
      get localStorage(): typeof storage {
        throw new Error("blocked getter");
      },
    };
    expect(reviewTabStorage(blockedWindow)).toBeUndefined();
  });
});
