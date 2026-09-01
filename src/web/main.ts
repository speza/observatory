#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { delimiter, extname, join, normalize, resolve } from "node:path";
import { createObservatoryRuntime, initializeObservatoryRuntime } from "../runtime/runtime.ts";
import { createStartAgentCoordinator } from "../session-launch/coordinator.ts";
import { LocalWorkspaceProvider } from "../workspaces/local.ts";
import { ObservatoryWebApi } from "./api.ts";
import { loadPluginRegistry, readPluginConfiguration } from "../plugins/registry.ts";
import { DefaultAgentRepositoryStatusReader } from "../repositories/reader.ts";
import { ConversationTracker } from "../conversations/tracker.ts";
import { AgentObservationCoordinator } from "../agent-observations/coordinator.ts";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
} as const;

const contentTypeFor = (path: string): string => {
  const extension = extname(path);
  if (extension === ".css") return contentTypes[".css"];
  if (extension === ".html") return contentTypes[".html"];
  if (extension === ".js") return contentTypes[".js"];
  if (extension === ".svg") return contentTypes[".svg"];
  return "application/octet-stream";
};

const staticRoot = normalize(join(import.meta.dir, "../../web/dist"));

const staticResponse = async (url: URL): Promise<Response> => {
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const path = normalize(join(staticRoot, requested));
  if (!path.startsWith(`${staticRoot}/`) && path !== staticRoot)
    return new Response("Not found.", { status: 404 });
  let file = Bun.file(path);
  if (!(await file.exists())) file = Bun.file(join(staticRoot, "index.html"));
  if (!(await file.exists()))
    return new Response("Build the web client with `bun run build:web`.", { status: 503 });
  return new Response(file, {
    headers: {
      "content-type": contentTypeFor(file.name ?? path),
      "x-content-type-options": "nosniff",
    },
  });
};

const program = Effect.scoped(
  Effect.gen(function* () {
    const runtime = createObservatoryRuntime();
    const port = Number(process.env.AO_WEB_PORT ?? 4310);
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
    const configuredPlugins = yield* Effect.promise(() =>
      readPluginConfiguration(process.env.AO_PLUGIN_CONFIG),
    );
    const builtInPlugins = [
      { path: resolve(import.meta.dir, "../../plugins/agent-harnesses") },
      { path: resolve(import.meta.dir, "../../plugins/github") },
      ...(runtime.useMockHost
        ? [{ path: resolve(import.meta.dir, "../../plugins/mock-agent-harnesses") }]
        : []),
    ];
    const configuredPaths = new Set(configuredPlugins.map(({ path }) => resolve(path)));
    const plugins = yield* loadPluginRegistry({
      packages: [
        ...builtInPlugins.filter(({ path }) => !configuredPaths.has(path)),
        ...configuredPlugins,
      ],
      now: () => runtime.clock.now(),
    });
    const repositoryStatus = new DefaultAgentRepositoryStatusReader(
      runtime.universe,
      runtime.clock,
      workspace,
      plugins,
    );
    const conversations = new ConversationTracker(plugins, runtime.store, runtime.universe);
    const agentObservations = new AgentObservationCoordinator(
      plugins,
      runtime.store,
      runtime.universe,
      () => runtime.clock.now(),
    );
    const startAgent = createStartAgentCoordinator({
      universe: runtime.universe,
      host: runtime.host,
      harnesses: plugins,
      workspace,
      receipts: runtime.store,
      reconcileHost: conversations.observeHost.bind(conversations),
    });
    const providerRefresh =
      process.env.AO_HOST === "mock"
        ? {
            observedProviders: 0,
            discoveredConversations: 0,
            admittedConversations: 0,
            diagnostics: [],
          }
        : yield* conversations.refresh();
    const observationRefresh = yield* agentObservations.refresh();
    const initialMessage = yield* initializeObservatoryRuntime(
      runtime,
      conversations.observeHost.bind(conversations),
    );
    yield* startAgent.refreshPending();
    const api = new ObservatoryWebApi(
      runtime.universe,
      runtime.clock,
      `http://127.0.0.1:${port}`,
      runtime.host,
      workspace,
      { coordinator: startAgent, workspace },
      repositoryStatus,
      plugins,
      conversations,
      agentObservations,
    );
    const refreshMs = Number(process.env.AO_WEB_REFRESH_MS ?? 2_000);
    const providerRefreshMs = Number(process.env.AO_PROVIDER_REFRESH_MS ?? 60_000);
    const observationRefreshMs = Number(process.env.AO_OBSERVATION_REFRESH_MS ?? 2_000);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: (request) => {
        const url = new URL(request.url);
        return url.pathname.startsWith("/api/") ? api.fetch(request) : staticResponse(url);
      },
    });
    const refresh = (): void => {
      void Effect.runPromise(runtime.host.snapshot())
        .then((snapshot) => {
          conversations.observeHost(snapshot);
          return Effect.runPromise(startAgent.refreshPending());
        })
        .catch((error: Error) => {
          console.error(`Observatory refresh failed: ${error.message}`);
        });
    };
    const timer = setInterval(refresh, refreshMs);
    const providerTimer =
      process.env.AO_HOST === "mock"
        ? undefined
        : setInterval(() => {
            void Effect.runPromise(conversations.refresh()).catch((error: Error) => {
              console.error(`Conversation refresh failed: ${error.message}`);
            });
          }, providerRefreshMs);
    const observationTimer = setInterval(() => {
      void Effect.runPromise(agentObservations.refresh()).catch((error: Error) => {
        console.error(`Agent-observation refresh failed: ${error.message}`);
      });
    }, observationRefreshMs);
    console.log(
      `${initialMessage} · ${providerRefresh.discoveredConversations} provider conversations discovered · ${observationRefresh.observedSources} observation sources\nObservatory web · http://${server.hostname}:${server.port}`,
    );

    yield* Effect.acquireRelease(Effect.succeed(server), (runningServer) =>
      Effect.promise(async () => {
        clearInterval(timer);
        if (providerTimer) clearInterval(providerTimer);
        clearInterval(observationTimer);
        await api.close();
        void runningServer.stop(true);
        runtime.store.close?.();
      }),
    );
    yield* Effect.never;
  }),
);

BunRuntime.runMain(program);
