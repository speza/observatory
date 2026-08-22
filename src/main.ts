#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HerdrHostAdapter } from "./hosts/herdr/adapter.ts";
import { MockHostAdapter } from "./hosts/mock/adapter.ts";
import { createMockScenario } from "./hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "./hosts/mock/seed.ts";
import type { SessionHost } from "./hosts/types.ts";
import { SqliteUniverseStore } from "./persistence/sqlite/sqlite-store.ts";
import { createProjectionModule } from "./projection/projection.ts";
import { createCommandCentreRenderer } from "./renderer/tui.ts";
import { Universe } from "./universe/universe.ts";
import type { Clock, IdGenerator } from "./universe/types.ts";

class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

class RuntimeIds implements IdGenerator {
  private sequence = 0;

  next(kind: "goal" | "session"): string {
    this.sequence += 1;
    return `${kind}-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

const clock = new SystemClock();
const databasePath =
  process.env.AO_DB_PATH ?? `${process.cwd()}/data/ao.sqlite`;
if (databasePath !== ":memory:")
  mkdirSync(dirname(databasePath), { recursive: true });
const store = new SqliteUniverseStore(databasePath);
const useMockHost = process.env.AO_HOST?.trim().toLowerCase() === "mock";
const host: SessionHost = useMockHost
  ? new MockHostAdapter({
      clock,
      scenario: createMockScenario(process.env.AO_MOCK_SCENARIO ?? "orbit"),
      ...(process.env.AO_MOCK_TICK_MS
        ? { tickMs: Number(process.env.AO_MOCK_TICK_MS) }
        : {}),
    })
  : new HerdrHostAdapter({ clock });
const universe = new Universe(
  store,
  clock,
  new RuntimeIds(),
  createProjectionModule(),
);

const reconcile = async (): Promise<string> => {
  const snapshot = await host.snapshot();
  const result = universe.reconcile(snapshot);
  const hostLabel = snapshot.hostKind === "mock" ? "Mock" : "Herdr";
  if (!result.accepted)
    return result.error ?? `${hostLabel} reconciliation rejected the snapshot.`;
  if (!snapshot.available)
    return `${hostLabel} unavailable · stored state retained${snapshot.error ? ` · ${snapshot.error}` : ""}`;
  return `${hostLabel} refreshed · ${snapshot.sessions.length} sessions · ${result.addedSessionIds.length} new · ${result.staleSessionIds.length} stale`;
};

let initialMessage = await reconcile();
if (useMockHost && process.env.AO_MOCK_SEED === "portfolio") {
  const seeded = seedMockPortfolio(universe);
  if (seeded.createdGoals > 0)
    initialMessage += ` · seeded ${seeded.createdGoals} goals/${seeded.assignedSessions} sessions`;
}
const app = await createCommandCentreRenderer({
  universe,
  host,
  clock,
  refresh: reconcile,
  initialAction: initialMessage,
  onClose: () => store.close?.(),
});
app.start();
