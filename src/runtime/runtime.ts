import { Effect } from "effect";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HerdrHostAdapter } from "../hosts/herdr/adapter.ts";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { createMockScenario } from "../hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "../hosts/mock/seed.ts";
import { displayHostKind, type HostSnapshot, type SessionHost } from "../hosts/types.ts";
import { SqliteUniverseStore } from "../persistence/sqlite/sqlite-store.ts";
import { createProjectionModule } from "../projection/projection.ts";
import { Universe, type ReconciliationResult } from "../universe/universe.ts";
import type { Clock, IdGenerator } from "../universe/types.ts";
import { positiveIntegerSetting } from "./config.ts";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

class RuntimeIds implements IdGenerator {
  private sequence = 0;

  next(kind: "system" | "goal" | "agent"): string {
    this.sequence += 1;
    return `${kind}-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

export interface ObservatoryRuntime {
  readonly clock: Clock;
  readonly host: SessionHost;
  readonly universe: Universe;
  readonly store: SqliteUniverseStore;
  readonly reconcile: ReturnType<typeof createReconcile>;
  readonly useMockHost: boolean;
}

const createReconcile = (
  host: SessionHost,
  universe: Universe,
  reconcileSnapshot: (snapshot: HostSnapshot) => ReconciliationResult = (snapshot) =>
    universe.observe({ kind: "host-executions", snapshot }),
) =>
  Effect.gen(function* () {
    const snapshot = yield* host.snapshot();
    const result = reconcileSnapshot(snapshot);
    const hostLabel = displayHostKind(snapshot.hostKind);
    if (!result.accepted)
      return result.error ?? `${hostLabel} reconciliation rejected the snapshot.`;
    if (!snapshot.available)
      return `${hostLabel} unavailable · stored state retained${snapshot.error ? ` · ${snapshot.error}` : ""}`;
    return `${hostLabel} refreshed · ${snapshot.agents.length} executions · ${result.updatedAgentIds.length} tracked updates · ${result.staleAgentIds.length} absent`;
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
          tickMs: positiveIntegerSetting(
            "AO_MOCK_TICK_MS",
            process.env.AO_MOCK_TICK_MS,
            scenario.tickMs,
          ),
        });
      })()
    : new HerdrHostAdapter({ clock });
  const universe = new Universe(store, clock, new RuntimeIds(), createProjectionModule());
  universe.invalidateRuntimeFacts();
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

export const initializeObservatoryRuntime = (
  runtime: ObservatoryRuntime,
  reconcileSnapshot?: Parameters<typeof createReconcile>[2],
) =>
  Effect.gen(function* () {
    let message = yield* reconcileSnapshot
      ? createReconcile(runtime.host, runtime.universe, reconcileSnapshot)
      : runtime.reconcile;
    if (runtime.useMockHost && process.env.AO_MOCK_SEED === "portfolio") {
      const snapshot = yield* runtime.host.snapshot();
      const seeded = seedMockPortfolio(runtime.universe, snapshot);
      if (seeded.createdGoals > 0)
        message += ` · seeded ${seeded.createdGoals} goals/${seeded.assignedAgents} agents`;
    }
    return message;
  });
