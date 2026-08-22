import { describe, expect, test } from "bun:test";
import { filterAssignableSessions } from "./assignment.ts";
import type { SessionView } from "../projection/types.ts";

const session = (overrides: Partial<SessionView> = {}): SessionView => ({
  id: overrides.id ?? "session-1",
  hostKind: "mock",
  nativeId: "native-1",
  displayName: "Model router implementation",
  displayNameSource: "host",
  runtimeState: "working",
  runtimeStateSource: "mock",
  hostHealth: "live",
  lastSeenAt: 1,
  lastObservedAt: 1,
  lastChangedAt: 1,
  hostLocator: "mock://session-1",
  ...overrides,
});

describe("assignment picker", () => {
  test("starts with the complete inbox and matches useful session metadata", () => {
    const sessions = [
      session(),
      session({ id: "session-2", displayName: "Memory reminders", repository: "observatory" }),
    ];

    expect(filterAssignableSessions(sessions, "")).toEqual(sessions);
    expect(filterAssignableSessions(sessions, "observatory").map((item) => item.id)).toEqual([
      "session-2",
    ]);
    expect(filterAssignableSessions(sessions, "ROUTER").map((item) => item.id)).toEqual([
      "session-1",
    ]);
  });

  test("returns an empty result when the inbox input has no match", () => {
    const sessions = [session()];
    expect(filterAssignableSessions(sessions, "missing")).toHaveLength(0);
  });
});
