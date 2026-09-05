#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
import { readFile, stat } from "node:fs/promises";
import { delimiter, extname, join, normalize, resolve } from "node:path";
import { ControlPlaneEventHub } from "../control-plane-events/index.ts";
import { createObservatoryRuntime, initializeObservatoryRuntime } from "../runtime/runtime.ts";
import { createStartAgentCoordinator } from "../session-launch/coordinator.ts";
import { LocalWorkspaceProvider } from "../workspaces/local.ts";
import { ObservatoryWebApi } from "./api.ts";
import type { WebTerminalServerMessage } from "./protocol.ts";
import { WebTerminalError, type WebTerminalSocketConnection } from "./terminal.ts";
import { loadPluginRegistry, readPluginConfiguration } from "../plugins/registry.ts";
import { DefaultAgentRepositoryStatusReader } from "../repositories/reader.ts";
import { ConversationTracker } from "../conversations/tracker.ts";
import { AgentObservationCoordinator } from "../agent-observations/coordinator.ts";
import {
  defaultProviderObservationTokenPath,
  ProviderObservationIngress,
  validProviderObservationToken,
} from "../agent-observations/ingress.ts";
import { configuredLoopbackOrigin, isAllowedWebRequest } from "./security.ts";
import { positiveIntegerSetting } from "../runtime/config.ts";
import { pendingLaunchView } from "./launch.ts";
import { projectPortfolio } from "./portfolio.ts";
import { ProjectionPublisher } from "./projection-publisher.ts";
import { startSerializedRefreshLoop } from "./refresh-loop.ts";

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
const terminalSocketPath = /^\/api\/terminal\/([^/]+)\/socket$/u;

interface TerminalSocketData {
  sessionId: string;
  afterDeliveryId?: number;
  connection?: WebTerminalSocketConnection;
  outbound: string[];
  outboundBytes: number;
  backpressured: boolean;
  closeAfterFlush?: { code: number; reason: string };
}

const MAX_TERMINAL_SOCKET_QUEUE_BYTES = 1_048_576;

const closeTerminalSocketAfterFlush = (
  socket: Bun.ServerWebSocket<TerminalSocketData>,
  code: number,
  reason: string,
): void => {
  socket.data.closeAfterFlush = { code, reason };
  if (!socket.data.backpressured && socket.data.outbound.length === 0) socket.close(code, reason);
};

const sendTerminalSocketMessage = (
  socket: Bun.ServerWebSocket<TerminalSocketData>,
  message: WebTerminalServerMessage,
): void => {
  const encoded = JSON.stringify(message);
  if (socket.data.backpressured || socket.data.outbound.length > 0) {
    socket.data.outbound.push(encoded);
    socket.data.outboundBytes += encoded.length;
    if (socket.data.outboundBytes > MAX_TERMINAL_SOCKET_QUEUE_BYTES)
      socket.close(1013, "Terminal client is too slow");
    return;
  }
  const result = socket.send(encoded);
  if (result === 0) socket.close(1011, "Terminal delivery failed");
  else if (result === -1) socket.data.backpressured = true;
};

const drainTerminalSocket = (socket: Bun.ServerWebSocket<TerminalSocketData>): void => {
  socket.data.backpressured = false;
  while (!socket.data.backpressured) {
    const encoded = socket.data.outbound.shift();
    if (encoded === undefined) break;
    socket.data.outboundBytes -= encoded.length;
    const result = socket.send(encoded);
    if (result === 0) {
      socket.close(1011, "Terminal delivery failed");
      return;
    }
    if (result === -1) socket.data.backpressured = true;
  }
  const close = socket.data.closeAfterFlush;
  if (!socket.data.backpressured && socket.data.outbound.length === 0 && close)
    socket.close(close.code, close.reason);
};

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
    const events = new ControlPlaneEventHub();
    const runtime = createObservatoryRuntime(events);
    const port = positiveIntegerSetting("AO_WEB_PORT", process.env.AO_WEB_PORT, 4310, {
      maximum: 65_535,
    });
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
      events,
    );
    const startAgent = createStartAgentCoordinator({
      universe: runtime.universe,
      host: runtime.host,
      harnesses: plugins,
      workspace,
      receipts: runtime.store,
      reconcileHost: conversations.observeHost.bind(conversations),
      events,
      now: () => runtime.clock.now(),
    });
    const providerRefresh = runtime.useMockHost
      ? {
          observedProviders: 0,
          discoveredConversations: 0,
          diagnostics: [],
        }
      : yield* conversations.refresh();
    const observationRefresh = yield* agentObservations.refresh();
    const initialMessage = yield* initializeObservatoryRuntime(
      runtime,
      conversations.observeHost.bind(conversations),
    );
    if (runtime.useMockHost && process.env.AO_MOCK_SEED === "portfolio") {
      const catchUp = runtime.universe.project({ kind: "catch-up", now: runtime.clock.now() });
      if (catchUp.kind === "catch-up" && catchUp.sinceAt === undefined) {
        runtime.universe.execute({
          type: "AcknowledgeCatchUp",
          throughSequence: catchUp.throughSequence,
        });
        agentObservations.acknowledge(
          agentObservations.snapshot().throughSequence,
          runtime.clock.now(),
        );
      }
    }
    yield* startAgent.refreshPending();
    const allowedOrigin = configuredLoopbackOrigin(
      "AO_WEB_ALLOWED_ORIGIN",
      process.env.AO_WEB_ALLOWED_ORIGIN,
      `http://127.0.0.1:${port}`,
    );
    const projectionPublisher = new ProjectionPublisher({
      events,
      projectPortfolio: () => {
        const portfolio = projectPortfolio(
          runtime.universe,
          runtime.clock.now(),
          agentObservations,
        );
        if (!portfolio) throw new Error("Projection contract mismatch.");
        return portfolio;
      },
      pendingLaunches: () => startAgent.pendingLaunches().map(pendingLaunchView),
      now: () => runtime.clock.now(),
      allowedOrigin,
      onError: (message) => console.error(message),
    });
    const api = new ObservatoryWebApi({
      projectionPublisher,
      universe: runtime.universe,
      clock: runtime.clock,
      allowedOrigin,
      host: runtime.host,
      launch: { coordinator: startAgent, workspace },
      repositoryStatus,
      plugins,
      conversations,
      agentObservations,
      workspaceReview: workspace,
    });
    const refreshMs = positiveIntegerSetting(
      "AO_WEB_REFRESH_MS",
      process.env.AO_WEB_REFRESH_MS,
      2_000,
      { minimum: 100 },
    );
    const hasPullObservationSource = plugins
      .agentHarnesses()
      .some(
        (harness) =>
          harness.observationSource !== undefined && harness.observationReceiver === undefined,
      );
    const observationRefreshMs = hasPullObservationSource
      ? positiveIntegerSetting(
          "AO_OBSERVATION_REFRESH_MS",
          process.env.AO_OBSERVATION_REFRESH_MS,
          2_000,
          { minimum: 100 },
        )
      : undefined;
    const observationTokenPath =
      process.env.AO_OBSERVATION_TOKEN_FILE ?? defaultProviderObservationTokenPath();
    const observationToken = yield* Effect.promise(async () => {
      try {
        const metadata = await stat(observationTokenPath);
        if (!metadata.isFile() || metadata.size > 256 || (metadata.mode & 0o077) !== 0) return "";
        const value = (await readFile(observationTokenPath, "utf8")).trim();
        return validProviderObservationToken(value) ? value : "";
      } catch {
        return "";
      }
    });
    const observationIngress = observationToken
      ? new ProviderObservationIngress(observationToken, plugins, agentObservations)
      : undefined;
    const server = Bun.serve<TerminalSocketData>({
      hostname: "127.0.0.1",
      port,
      idleTimeout: 30,
      fetch: (request, runningServer) => {
        if (!isAllowedWebRequest(request, allowedOrigin))
          return new Response("Request origin rejected.", { status: 403 });
        const url = new URL(request.url);
        const terminalSocket = terminalSocketPath.exec(url.pathname);
        if (terminalSocket) {
          const sessionId = terminalSocket[1];
          const rawAfterDeliveryId = url.searchParams.get("after");
          const afterDeliveryId =
            rawAfterDeliveryId === null ? undefined : Number(rawAfterDeliveryId);
          if (
            !sessionId ||
            (afterDeliveryId !== undefined &&
              (!Number.isSafeInteger(afterDeliveryId) || afterDeliveryId < 0)) ||
            !runningServer.upgrade(request, {
              data: {
                sessionId,
                afterDeliveryId,
                outbound: [],
                outboundBytes: 0,
                backpressured: false,
              },
            })
          )
            return new Response("Terminal WebSocket upgrade failed.", { status: 400 });
          return;
        }
        if (url.pathname === "/api/provider-observations")
          return (
            observationIngress?.fetch(request) ?? new Response("Not configured.", { status: 503 })
          );
        if (url.pathname === "/api/projections/events") return projectionPublisher.stream(request);
        return url.pathname.startsWith("/api/") ? api.fetch(request) : staticResponse(url);
      },
      websocket: {
        open: (socket) => {
          try {
            socket.data.connection = api.connectTerminalSocket(
              socket.data.sessionId,
              (message) => {
                sendTerminalSocketMessage(socket, message);
                if (message.kind === "closed")
                  closeTerminalSocketAfterFlush(socket, 1000, "Terminal closed");
              },
              socket.data.afterDeliveryId,
            );
          } catch (error) {
            sendTerminalSocketMessage(socket, {
              kind: "closed",
              reason:
                error instanceof WebTerminalError ? error.message : "Terminal transport failed.",
            });
            closeTerminalSocketAfterFlush(socket, 1008, "Terminal unavailable");
          }
        },
        message: (socket, message) => {
          if (Schema.is(Schema.String)(message)) {
            void socket.data.connection?.receive(message);
            return;
          }
          sendTerminalSocketMessage(socket, {
            kind: "error",
            message: "Terminal messages must be JSON text.",
          });
        },
        drain: (socket) => {
          drainTerminalSocket(socket);
        },
        close: (socket) => {
          void socket.data.connection?.close().catch(() => undefined);
        },
      },
    });
    const hostLoop = startSerializedRefreshLoop({
      intervalMs: refreshMs,
      refresh: async () => {
        const snapshot = await Effect.runPromise(runtime.host.snapshot());
        conversations.observeHost(snapshot);
        await Effect.runPromise(startAgent.refreshPending());
      },
      onError: (message) => console.error(`Observatory refresh failed: ${message}`),
    });
    const observationLoop =
      observationRefreshMs === undefined
        ? undefined
        : startSerializedRefreshLoop({
            intervalMs: observationRefreshMs,
            refresh: async () => {
              await Effect.runPromise(agentObservations.refresh());
            },
            onError: (message) => console.error(`Agent-observation refresh failed: ${message}`),
          });
    console.log(
      `${initialMessage} · ${providerRefresh.discoveredConversations} provider conversations discovered · ${observationRefresh.observedSources} observation sources\nObservatory web · http://${server.hostname}:${server.port}`,
    );

    yield* Effect.acquireRelease(Effect.succeed(server), (runningServer) =>
      Effect.promise(async () => {
        hostLoop.stop();
        observationLoop?.stop();
        projectionPublisher.close();
        await api.close();
        void runningServer.stop(true);
        runtime.store.close?.();
      }),
    );
    yield* Effect.never;
  }),
);

BunRuntime.runMain(program);
