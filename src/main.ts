#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { delimiter } from "node:path";
import { createCommandCentreRenderer } from "./renderer/tui.ts";
import { createObservatoryRuntime, initializeObservatoryRuntime } from "./runtime/runtime.ts";
import { createStartAgentCoordinator } from "./session-launch/coordinator.ts";
import { LocalWorkspaceProvider } from "./workspaces/local.ts";

const program = Effect.scoped(
  Effect.gen(function* () {
    const runtime = createObservatoryRuntime();
    const initialMessage = yield* initializeObservatoryRuntime(runtime);
    const configuredWorkspaceLocations = (process.env.AO_WORKSPACE_LOCATIONS ?? "")
      .split(delimiter)
      .map((location) => location.trim())
      .filter(Boolean);
    const discoveredWorkspaceLocations = runtime.universe
      .snapshot()
      .agents.filter((agent) => agent.archivedAt === undefined)
      .map((agent) => agent.worktree)
      .filter((path): path is string => Boolean(path));
    const workspace = new LocalWorkspaceProvider({
      locations: [...configuredWorkspaceLocations, ...discoveredWorkspaceLocations],
    });
    const startAgent = createStartAgentCoordinator({
      universe: runtime.universe,
      host: runtime.host,
      workspace,
      refresh: runtime.reconcile,
    });
    const app = yield* Effect.tryPromise({
      try: () =>
        createCommandCentreRenderer({
          universe: runtime.universe,
          host: runtime.host,
          startAgent,
          workspace,
          clock: runtime.clock,
          refresh: runtime.reconcile,
          initialAction: initialMessage,
          onClose: () => runtime.store.close?.(),
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
