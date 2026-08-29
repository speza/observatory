import { Effect, Schema } from "effect";
import type { PluginRegistry } from "../plugins/registry.ts";
import type {
  ResumeAgentIntent,
  StartAgentCoordinator,
  StartAgentIntent,
} from "../session-launch/types.ts";
import type { Universe } from "../universe/universe.ts";
import type { WorkspaceProvider } from "../workspaces/types.ts";
import type {
  WebLaunchOptionsResponse,
  WebResumeAgentRequest,
  WebStartAgentRequest,
  WebWorkspaceBrowserResponse,
} from "./protocol.ts";

const MAX_LAUNCH_BYTES = 32_768;
const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
const Path = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4_096));
const OptionalName = Schema.optional(Schema.String.pipe(Schema.maxLength(240)));
const OptionalPrompt = Schema.optional(Schema.String.pipe(Schema.maxLength(16_384)));

const WorkspaceSelectionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("existing"), path: Path }),
  Schema.Struct({
    kind: Schema.Literal("worktree"),
    repositoryPath: Path,
    branch: Id,
    base: Schema.optional(Id),
    path: Schema.optional(Path),
  }),
);

const WebStartAgentRequestSchema: Schema.Schema<WebStartAgentRequest> = Schema.Struct({
  requestId: Id,
  goalId: Schema.optional(Id),
  workspace: WorkspaceSelectionSchema,
  harnessId: Id,
  agentName: OptionalName,
  prompt: OptionalPrompt,
});

const WebResumeAgentRequestSchema: Schema.Schema<WebResumeAgentRequest> = Schema.Struct({
  requestId: Id,
  agentId: Id,
  prompt: OptionalPrompt,
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

  async start(encoded: string) {
    const request = decodeRequest(encoded);
    const intent: StartAgentIntent = {
      requestId: request.requestId,
      goal: request.goalId ? { kind: "goal", goalId: request.goalId } : { kind: "inbox" },
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
