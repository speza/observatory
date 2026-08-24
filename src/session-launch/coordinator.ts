import { Effect } from "effect";
import type { HostError } from "../hosts/errors.ts";
import type { GoalId } from "../universe/types.ts";
import type { WorkspaceError } from "../workspaces/types.ts";
import {
  launchError,
  type LaunchError,
  type StartAgentCoordinator,
  type StartAgentCoordinatorOptions,
  type StartAgentIntent,
  type StartAgentResult,
} from "./types.ts";

const mapWorkspaceError = (error: WorkspaceError): LaunchError =>
  launchError(error.operation, error.message);

const mapHostError = (error: HostError): LaunchError => launchError(error.operation, error.message);

const agentName = (intent: StartAgentIntent): string | undefined =>
  intent.agentName?.trim() || intent.agent.name?.trim() || undefined;

export class DefaultStartAgentCoordinator implements StartAgentCoordinator {
  private readonly receipts = new Map<string, StartAgentResult>();

  constructor(private readonly options: StartAgentCoordinatorOptions) {}

  start(intent: StartAgentIntent): Effect.Effect<StartAgentResult, LaunchError> {
    return Effect.gen(this, function* () {
      const requestId = intent.requestId.trim();
      if (!requestId)
        return yield* Effect.fail(launchError("launch.validate", "requestId is required."));
      const previous = this.receipts.get(requestId);
      if (previous)
        return {
          ...previous,
          status: "already-observed",
          message: `Request ${requestId} was already processed: ${previous.message}`,
        } satisfies StartAgentResult;
      const agentKind = intent.agent.kind.trim();
      if (!agentKind)
        return yield* Effect.fail(launchError("launch.validate", "An agent kind is required."));
      const before = this.options.universe.snapshot();
      const goalId = yield* this.resolveGoal(intent);
      const prepared = yield* this.options.workspace
        .prepare(intent.workspace)
        .pipe(Effect.mapError(mapWorkspaceError));
      const launched = yield* this.options.host
        .launch({
          workingDirectory: prepared.path,
          agentKind,
          agentName: agentName(intent),
          args: intent.agent.args,
          prompt: intent.prompt?.trim() || undefined,
          requestId,
        })
        .pipe(Effect.mapError(mapHostError));
      if (!launched.ok) {
        const failed = {
          status: "failed",
          requestId,
          goalId,
          workspace: prepared,
          warnings: prepared.warnings,
          message: launched.message,
        } satisfies StartAgentResult;
        this.receipts.set(requestId, failed);
        return failed;
      }
      yield* this.options.refresh.pipe(Effect.mapError(mapHostError));
      const agent = this.findLaunchedAgent(
        before.agents.map((candidate) => candidate.id),
        launched.nativeId,
        prepared.path,
        agentKind,
        agentName(intent),
      );
      if (agent && goalId) {
        const assigned = this.options.universe.execute({
          type: "AssignAgent",
          agentId: agent.id,
          goalId,
        });
        if (!assigned.ok)
          return yield* Effect.fail(
            launchError(
              "launch.assign",
              assigned.error ?? "The launched agent could not be assigned.",
            ),
          );
      }
      const result: StartAgentResult = {
        status: agent ? "started" : "pending",
        requestId,
        goalId,
        agentId: agent?.id,
        workspace: prepared,
        warnings: prepared.warnings,
        message: agent
          ? `Started ${agentKind}${goalId ? " and assigned it to the goal" : ""}.`
          : `Started ${agentKind}; waiting for the host agent to appear.`,
      };
      this.receipts.set(requestId, result);
      return result;
    });
  }

  private resolveGoal(intent: StartAgentIntent): Effect.Effect<GoalId | undefined, LaunchError> {
    const goalIntent = intent.goal;
    if (goalIntent.kind === "inbox") return Effect.succeed(undefined);
    if (goalIntent.kind === "goal") {
      const goal = this.options.universe
        .snapshot()
        .goals.find((candidate) => candidate.id === goalIntent.goalId);
      if (!goal || goal.status !== "active")
        return Effect.fail(launchError("launch.goal", "The selected goal is not active."));
      return Effect.succeed(goal.id);
    }
    const result = this.options.universe.execute({
      type: "CreateGoal",
      title: goalIntent.title,
      description: goalIntent.description,
    });
    if (!result.ok || !result.goalId)
      return Effect.fail(
        launchError("launch.goal", result.error ?? "The new goal could not be created."),
      );
    return Effect.succeed(result.goalId);
  }

  private findLaunchedAgent(
    beforeIds: readonly string[],
    nativeId: string | undefined,
    workingDirectory: string,
    agentKind: string,
    displayName: string | undefined,
  ) {
    const before = new Set(beforeIds);
    const agents = this.options.universe
      .snapshot()
      .agents.filter((agent) => !before.has(agent.id) && agent.archivedAt === undefined);
    return (
      agents.find((agent) => nativeId !== undefined && agent.nativeId === nativeId) ??
      agents.find(
        (agent) =>
          agent.worktree === workingDirectory &&
          (agent.provider === agentKind || agent.displayName === displayName),
      ) ??
      agents.find((agent) => agent.displayName === displayName)
    );
  }
}

export const createStartAgentCoordinator = (
  options: StartAgentCoordinatorOptions,
): StartAgentCoordinator => new DefaultStartAgentCoordinator(options);
