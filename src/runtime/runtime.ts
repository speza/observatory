import { Effect } from "effect";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HerdrHostAdapter } from "../hosts/herdr/adapter.ts";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { createMockScenario } from "../hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "../hosts/mock/seed.ts";
import { displayHostKind, type SessionHost } from "../hosts/types.ts";
import { SqliteUniverseStore } from "../persistence/sqlite/sqlite-store.ts";
import { createProjectionModule } from "../projection/projection.ts";
import { Universe } from "../universe/universe.ts";
import type { Clock, IdGenerator, UniverseStore } from "../universe/types.ts";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

class RuntimeIds implements IdGenerator {
  private sequence = 0;

  next(kind: "goal" | "agent"): string {
    this.sequence += 1;
    return `${kind}-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

export interface ObservatoryRuntime {
  readonly clock: Clock;
  readonly host: SessionHost;
  readonly universe: Universe;
  readonly store: UniverseStore;
  readonly reconcile: ReturnType<typeof createReconcile>;
  readonly useMockHost: boolean;
}

const createReconcile = (host: SessionHost, universe: Universe) =>
  Effect.gen(function* () {
    const snapshot = yield* host.snapshot();
    const result = universe.reconcile(snapshot);
    const hostLabel = displayHostKind(snapshot.hostKind);
    if (!result.accepted)
      return result.error ?? `${hostLabel} reconciliation rejected the snapshot.`;
    if (!snapshot.available)
      return `${hostLabel} unavailable · stored state retained${snapshot.error ? ` · ${snapshot.error}` : ""}`;
    return `${hostLabel} refreshed · ${snapshot.agents.length} agents · ${result.addedAgentIds.length} new · ${result.staleAgentIds.length} stale`;
  });

export const createObservatoryRuntime = (): ObservatoryRuntime => {
  const clock = new SystemClock();
  const databasePath = process.env.AO_DB_PATH ?? `${process.cwd()}/data/ao.sqlite`;
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const store = new SqliteUniverseStore(databasePath);
  const useMockHost = process.env.AO_HOST?.trim().toLowerCase() === "mock";
  const host: SessionHost = useMockHost
    ? (() => {
        const scenario = createMockScenario(process.env.AO_MOCK_SCENARIO ?? "orbit");
        return new MockHostAdapter({
          clock,
          scenario,
          tickMs: Number(process.env.AO_MOCK_TICK_MS ?? scenario.tickMs),
        });
      })()
    : new HerdrHostAdapter({ clock });
  const universe = new Universe(store, clock, new RuntimeIds(), createProjectionModule());
  const reconcile = createReconcile(host, universe);
  return {
    clock,
    host,
    universe,
    store,
    reconcile,
    useMockHost,
  };
};

export const initializeObservatoryRuntime = (runtime: ObservatoryRuntime) =>
  Effect.gen(function* () {
    let message = yield* runtime.reconcile;
    if (runtime.useMockHost && process.env.AO_MOCK_SEED === "portfolio") {
      const seeded = seedMockPortfolio(runtime.universe);
      if (seeded.createdGoals > 0)
        message += ` · seeded ${seeded.createdGoals} goals/${seeded.assignedAgents} agents`;
    }
    return message;
  });
