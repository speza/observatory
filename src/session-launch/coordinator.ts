import { Effect } from "effect";
import type { HostError } from "../hosts/errors.ts";
import type { GoalId } from "../universe/types.ts";
import type { WorkspaceError } from "../workspaces/types.ts";
import {
  launchError,
  type LaunchError,
  type StartSessionCoordinator,
  type StartSessionCoordinatorOptions,
  type StartSessionIntent,
  type StartSessionResult,
} from "./types.ts";

const mapWorkspaceError = (error: WorkspaceError): LaunchError =>
  launchError(error.operation, error.message);

const mapHostError = (error: HostError): LaunchError => launchError(error.operation, error.message);

const sessionName = (intent: StartSessionIntent): string | undefined =>
  intent.sessionName?.trim() || intent.agent.name?.trim() || undefined;

export class DefaultStartSessionCoordinator implements StartSessionCoordinator {
  private readonly receipts = new Map<string, StartSessionResult>();

  constructor(private readonly options: StartSessionCoordinatorOptions) {}

  start(intent: StartSessionIntent): Effect.Effect<StartSessionResult, LaunchError> {
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
        } satisfies StartSessionResult;
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
          agentName: sessionName(intent),
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
        } satisfies StartSessionResult;
        this.receipts.set(requestId, failed);
        return failed;
      }
      yield* this.options.refresh.pipe(Effect.mapError(mapHostError));
      const session = this.findLaunchedSession(
        before.sessions.map((candidate) => candidate.id),
        launched.nativeId,
        prepared.path,
        agentKind,
        sessionName(intent),
      );
      if (session && goalId) {
        const assigned = this.options.universe.execute({
          type: "AssignSession",
          sessionId: session.id,
          goalId,
        });
        if (!assigned.ok)
          return yield* Effect.fail(
            launchError(
              "launch.assign",
              assigned.error ?? "The launched session could not be assigned.",
            ),
          );
      }
      const result: StartSessionResult = {
        status: session ? "started" : "pending",
        requestId,
        goalId,
        sessionId: session?.id,
        workspace: prepared,
        warnings: prepared.warnings,
        message: session
          ? `Started ${agentKind}${goalId ? " and assigned it to the goal" : ""}.`
          : `Started ${agentKind}; waiting for the host session to appear.`,
      };
      this.receipts.set(requestId, result);
      return result;
    });
  }

  private resolveGoal(intent: StartSessionIntent): Effect.Effect<GoalId | undefined, LaunchError> {
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

  private findLaunchedSession(
    beforeIds: readonly string[],
    nativeId: string | undefined,
    workingDirectory: string,
    agentKind: string,
    displayName: string | undefined,
  ) {
    const before = new Set(beforeIds);
    const sessions = this.options.universe
      .snapshot()
      .sessions.filter((session) => !before.has(session.id) && session.archivedAt === undefined);
    return (
      sessions.find((session) => nativeId !== undefined && session.nativeId === nativeId) ??
      sessions.find(
        (session) =>
          session.worktree === workingDirectory &&
          (session.provider === agentKind || session.displayName === displayName),
      ) ??
      sessions.find((session) => session.displayName === displayName)
    );
  }
}

export const createStartSessionCoordinator = (
  options: StartSessionCoordinatorOptions,
): StartSessionCoordinator => new DefaultStartSessionCoordinator(options);
