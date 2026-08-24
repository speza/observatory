#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { mkdirSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import { HerdrHostAdapter } from "./hosts/herdr/adapter.ts";
import { MockHostAdapter } from "./hosts/mock/adapter.ts";
import { createMockScenario } from "./hosts/mock/scenarios.ts";
import { seedMockPortfolio } from "./hosts/mock/seed.ts";
import { displayHostKind, type SessionHost } from "./hosts/types.ts";
import { SqliteUniverseStore } from "./persistence/sqlite/sqlite-store.ts";
import { createProjectionModule } from "./projection/projection.ts";
import { createCommandCentreRenderer } from "./renderer/tui.ts";
import { createStartAgentCoordinator } from "./session-launch/coordinator.ts";
import { Universe } from "./universe/universe.ts";
import { LocalWorkspaceProvider } from "./workspaces/local.ts";
import type { Clock, IdGenerator } from "./universe/types.ts";

class SystemClock implements Clock {
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

const program = Effect.scoped(
  Effect.gen(function* () {
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

    const reconcile = Effect.gen(function* () {
      const snapshot = yield* host.snapshot();
      const result = universe.reconcile(snapshot);
      const hostLabel = displayHostKind(snapshot.hostKind);
      if (!result.accepted)
        return result.error ?? `${hostLabel} reconciliation rejected the snapshot.`;
      if (!snapshot.available)
        return `${hostLabel} unavailable · stored state retained${snapshot.error ? ` · ${snapshot.error}` : ""}`;
      return `${hostLabel} refreshed · ${snapshot.agents.length} agents · ${result.addedAgentIds.length} new · ${result.staleAgentIds.length} stale`;
    });

    let initialMessage = yield* reconcile;
    if (useMockHost && process.env.AO_MOCK_SEED === "portfolio") {
      const seeded = seedMockPortfolio(universe);
      if (seeded.createdGoals > 0)
        initialMessage += ` · seeded ${seeded.createdGoals} goals/${seeded.assignedAgents} agents`;
    }
    const configuredWorkspaceLocations = (process.env.AO_WORKSPACE_LOCATIONS ?? "")
      .split(delimiter)
      .map((location) => location.trim())
      .filter(Boolean);
    const discoveredWorkspaceLocations = universe
      .snapshot()
      .agents.filter((agent) => agent.archivedAt === undefined)
      .map((agent) => agent.worktree)
      .filter((path): path is string => Boolean(path));
    const workspace = new LocalWorkspaceProvider({
      locations: [...configuredWorkspaceLocations, ...discoveredWorkspaceLocations],
    });
    const startAgent = createStartAgentCoordinator({
      universe,
      host,
      workspace,
      refresh: reconcile,
    });
    const app = yield* Effect.tryPromise({
      try: () =>
        createCommandCentreRenderer({
          universe,
          host,
          startAgent,
          workspace,
          clock,
          refresh: reconcile,
          initialAction: initialMessage,
          onClose: () => store.close?.(),
        }),
      catch: () => new Error("Could not create the Observatory renderer."),
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        app.start();
        return app;
      }),
      (runningApp) => Effect.sync(() => runningApp.shutdown()),
    );
    yield* Effect.never;
  }),
);

BunRuntime.runMain(program);
