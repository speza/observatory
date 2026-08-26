#!/usr/bin/env bun

import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { delimiter, extname, join, normalize } from "node:path";
import { createObservatoryRuntime, initializeObservatoryRuntime } from "../runtime/runtime.ts";
import { createStartAgentCoordinator } from "../session-launch/coordinator.ts";
import { LocalWorkspaceProvider } from "../workspaces/local.ts";
import { ObservatoryWebApi } from "./api.ts";

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
    const initialMessage = yield* initializeObservatoryRuntime(runtime);
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
    const startAgent = createStartAgentCoordinator({
      universe: runtime.universe,
      host: runtime.host,
      workspace,
      refresh: runtime.reconcile,
    });
    const api = new ObservatoryWebApi(
      runtime.universe,
      runtime.clock,
      `http://127.0.0.1:${port}`,
      runtime.host,
      workspace,
      { coordinator: startAgent, workspace },
    );
    const refreshMs = Number(process.env.AO_WEB_REFRESH_MS ?? 2_000);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: (request) => {
        const url = new URL(request.url);
        return url.pathname.startsWith("/api/") ? api.fetch(request) : staticResponse(url);
      },
    });
    const refresh = (): void => {
      void Effect.runPromise(runtime.reconcile).catch((error: Error) => {
        console.error(`Observatory refresh failed: ${error.message}`);
      });
    };
    const timer = setInterval(refresh, refreshMs);
    console.log(`${initialMessage}\nObservatory web · http://${server.hostname}:${server.port}`);

    yield* Effect.acquireRelease(Effect.succeed(server), (runningServer) =>
      Effect.promise(async () => {
        clearInterval(timer);
        await api.close();
        void runningServer.stop(true);
        runtime.store.close?.();
      }),
    );
    yield* Effect.never;
  }),
);

BunRuntime.runMain(program);
