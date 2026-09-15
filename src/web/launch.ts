import { Effect, Schema } from "effect";
import type { PluginRegistry } from "../plugins/registry.ts";
import type {
  ResumeAgentIntent,
  StartAgentCoordinator,
  StartAgentIntent,
} from "../session-launch/types.ts";
import type { Universe } from "../universe/universe.ts";
import type { WorkspaceProvider } from "../workspaces/types.ts";
import {
  WebResumeAgentRequestSchema,
  WebStartAgentRequestSchema,
  type WebLaunchOptionsResponse,
  type WebPendingLaunch,
  type WebPendingLaunchesResponse,
  type WebResumeAgentRequest,
  type WebStartAgentRequest,
  type WebWorkspaceBrowserResponse,
} from "./protocol/index.ts";

const MAX_LAUNCH_BYTES = 32_768;

export const pendingLaunchView = (
  launch: ReturnType<StartAgentCoordinator["pendingLaunches"]>[number],
): WebPendingLaunch => ({
  requestId: launch.requestId,
  harnessId: launch.harnessId,
  displayName: launch.displayName,
  goalId: launch.goalId,
  systemId: launch.systemId,
  message: launch.message,
});

export class WebLaunchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const decodeRequest = (encoded: string): WebStartAgentRequest => {
  if (encoded.length > MAX_LAUNCH_BYTES)
    throw new WebLaunchError("Launch request is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(WebStartAgentRequestSchema))(encoded);
  } catch {
    throw new WebLaunchError("Launch request does not match the web contract.", 400);
  }
};

const decodeResumeRequest = (encoded: string): WebResumeAgentRequest => {
  if (encoded.length > MAX_LAUNCH_BYTES)
    throw new WebLaunchError("Resume request is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(WebResumeAgentRequestSchema))(encoded);
  } catch {
    throw new WebLaunchError("Resume request does not match the web contract.", 400);
  }
};

export class WebLaunchGateway {
  constructor(
    private readonly universe: Universe,
    private readonly plugins: PluginRegistry,
    private readonly workspace: WorkspaceProvider,
    private readonly coordinator: StartAgentCoordinator,
  ) {}

  async options(): Promise<WebLaunchOptionsResponse> {
    try {
      const [locations, agents] = await Promise.all([
        Effect.runPromise(this.workspace.listChoices()),
        Effect.runPromise(this.plugins.availableAgentHarnesses()),
      ]);
      return {
        kind: "launch-options",
        systems: this.universe
          .snapshot()
          .systems.map((system) => ({ id: system.id, title: system.title })),
        goals: this.universe
          .snapshot()
          .goals.filter((goal) => goal.status === "active")
          .map((goal) => ({ id: goal.id, title: goal.title, priority: goal.priority })),
        locations,
        agents,
      };
    } catch (error) {
      throw new WebLaunchError(
        error instanceof Error ? error.message : "Launch choices are unavailable.",
        503,
      );
    }
  }

  async browse(path: string): Promise<WebWorkspaceBrowserResponse> {
    if (!this.workspace.browse) throw new WebLaunchError("Workspace browsing is unavailable.", 501);
    try {
      const browser = await Effect.runPromise(this.workspace.browse(path));
      return { kind: "workspace-browser", ...browser };
    } catch (error) {
      throw new WebLaunchError(
        error instanceof Error ? error.message : "Workspace could not be browsed.",
        400,
      );
    }
  }

  async pending(refresh = false): Promise<WebPendingLaunchesResponse> {
    if (refresh) await Effect.runPromise(this.coordinator.refreshPending());
    return {
      kind: "pending-launches",
      launches: this.coordinator.pendingLaunches().map(pendingLaunchView),
    };
  }

  pendingLaunch(requestId: string): WebPendingLaunch | undefined {
    const launch = this.coordinator
      .pendingLaunches()
      .find((candidate) => candidate.requestId === requestId);
    return launch ? pendingLaunchView(launch) : undefined;
  }

  async start(encoded: string) {
    const request = decodeRequest(encoded);
    if (request.goalId && request.systemId)
      throw new WebLaunchError("Choose a Goal or a System, not both.", 400);
    const intent: StartAgentIntent = {
      requestId: request.requestId,
      goal: request.goalId
        ? { kind: "goal", goalId: request.goalId }
        : request.systemId
          ? { kind: "system", systemId: request.systemId }
          : { kind: "inbox" },
      workspace: request.workspace,
      harness: { id: request.harnessId },
      agentName: request.agentName,
      prompt: request.prompt,
      mode: "manual",
    };
    try {
      return await Effect.runPromise(this.coordinator.start(intent));
    } catch (error) {
      throw new WebLaunchError(
        error instanceof Error ? error.message : "Agent launch failed.",
        409,
      );
    }
  }

  async resume(encoded: string) {
    const request = decodeResumeRequest(encoded);
    const intent: ResumeAgentIntent = {
      requestId: request.requestId,
      agentId: request.agentId,
      prompt: request.prompt,
    };
    try {
      return await Effect.runPromise(this.coordinator.resume(intent));
    } catch (error) {
      throw new WebLaunchError(
        error instanceof Error ? error.message : "Agent resume failed.",
        409,
      );
    }
  }
}
