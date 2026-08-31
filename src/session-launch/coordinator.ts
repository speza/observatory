import { Effect } from "effect";
import { createHash } from "node:crypto";
import type { HostAgentObservation, HostSnapshot } from "../hosts/types.ts";
import type {
  AgentHarness,
  ContinuityResult,
  HarnessObservationEvidence,
  OpaqueNativeConversationRef,
} from "../plugin-sdk/index.ts";
import type { Agent, GoalId } from "../universe/types.ts";
import type { ReconciliationResult } from "../universe/universe.ts";
import { isPlausibleUnidentifiedExecution } from "../universe/execution-ambiguity.ts";
import type { WorkspaceError } from "../workspaces/types.ts";
import {
  launchError,
  type LaunchError,
  type LaunchReceipt,
  type LaunchRecovery,
  type LaunchReceiptStore,
  type PendingLaunch,
  type ResumeAgentIntent,
  type StartAgentCoordinator,
  type StartAgentCoordinatorOptions,
  type StartAgentIntent,
  type StartAgentResult,
} from "./types.ts";

const mapWorkspaceError = (error: WorkspaceError): LaunchError =>
  launchError(error.operation, error.message);

const mapError =
  (operation: string) =>
  (error: { readonly message: string }): LaunchError =>
    launchError(operation, error.message);

const agentName = (intent: StartAgentIntent): string | undefined =>
  intent.agentName?.trim() || intent.harness.name?.trim() || undefined;

const observationEvidence = (
  observation: HostAgentObservation | undefined,
): HarnessObservationEvidence | undefined => {
  if (!observation) return undefined;
  const evidence = observation.harnessEvidence;
  return {
    executionRef: observation.nativeId,
    detectedHarnessId: evidence?.detectedHarnessId,
    nativeConversationRef: evidence?.nativeConversationRef,
    restoreState: evidence?.restoreState,
    source: evidence?.source ?? "unknown",
    observedAt: evidence?.observedAt ?? observation.observedAt,
  };
};

const sameReference = (
  left: OpaqueNativeConversationRef | undefined,
  right: OpaqueNativeConversationRef,
): boolean =>
  left?.harnessId === right.harnessId &&
  left.continuityScopeId === right.continuityScopeId &&
  left.kind === right.kind &&
  left.value === right.value;

class MemoryLaunchReceiptStore implements LaunchReceiptStore {
  private readonly receipts = new Map<string, LaunchReceipt>();
  reserveLaunchReceipt(receipt: LaunchReceipt) {
    const existing = this.receipts.get(receipt.requestId);
    if (!existing) {
      this.receipts.set(receipt.requestId, receipt);
      return { kind: "reserved" as const };
    }
    return existing.intentFingerprint === receipt.intentFingerprint
      ? { kind: "existing" as const, receipt: existing }
      : { kind: "conflict" as const };
  }
  saveLaunchReceipt(receipt: LaunchReceipt): void {
    this.receipts.set(receipt.requestId, receipt);
  }
  launchReceipts(): readonly LaunchReceipt[] {
    return [...this.receipts.values()];
  }
}

const fingerprint = (
  kind: "start" | "resume",
  intent: StartAgentIntent | ResumeAgentIntent,
): string => createHash("sha256").update(JSON.stringify({ kind, intent })).digest("hex");

export class DefaultStartAgentCoordinator implements StartAgentCoordinator {
  private readonly receipts: LaunchReceiptStore;
  private readonly resumesInFlight = new Set<string>();

  constructor(private readonly options: StartAgentCoordinatorOptions) {
    this.receipts = options.receipts ?? new MemoryLaunchReceiptStore();
  }

  start(intent: StartAgentIntent): Effect.Effect<StartAgentResult, LaunchError> {
    return Effect.gen(this, function* () {
      const requestId = yield* this.validateRequestId(intent.requestId);
      const intentFingerprint = fingerprint("start", intent);
      const previous = yield* this.reserveReceipt(requestId, intentFingerprint);
      if (previous) return yield* this.recoverReceipt(previous);
      const harnessId = intent.harness.id.trim();
      const harness = yield* this.requireHarness(harnessId);
      yield* this.requireAvailable(harness);
      const goalId = yield* this.resolveGoal(intent);
      const requestedAgentName = agentName(intent);
      const prepared = yield* this.options.workspace
        .prepare(intent.workspace)
        .pipe(Effect.mapError(mapWorkspaceError));
      const plan = yield* harness
        .planStart({
          workingDirectory: prepared.path,
          prompt: intent.prompt?.trim() || undefined,
          args: intent.harness.args,
        })
        .pipe(Effect.mapError(mapError("harness.plan-start")));
      yield* this.observeHost();
      const launched = yield* this.options.host
        .launchExecution({
          workingDirectory: prepared.path,
          agentName: requestedAgentName,
          processPlan: plan,
          requestId,
        })
        .pipe(Effect.mapError(mapError("host.launch-execution")));
      if (!launched.ok)
        return yield* this.remember(
          {
            status: "failed",
            requestId,
            goalId,
            workspace: prepared,
            warnings: prepared.warnings,
            message: launched.message,
          },
          intentFingerprint,
        );

      const recovery = launched.executionRef
        ? ({
            kind: "start",
            harnessId,
            executionRef: launched.executionRef,
            displayName: requestedAgentName,
            nativeConversationRef: plan.nativeConversationRef,
            goalId,
          } satisfies LaunchRecovery)
        : undefined;
      yield* this.remember(
        {
          status: "pending",
          requestId,
          goalId,
          workspace: prepared,
          warnings: prepared.warnings,
          message: `${launched.message} Waiting for continuity evidence.`,
        },
        intentFingerprint,
        recovery,
      );

      const after = yield* this.observeHost();
      const observation = after.agents.find(
        (candidate) => candidate.nativeId === launched.executionRef,
      );
      const continuity = yield* harness
        .proveContinuity({
          observation: observationEvidence(observation),
          launchExecutionRef: launched.executionRef,
        })
        .pipe(Effect.mapError(mapError("harness.continuity")));
      const provedReference =
        plan.nativeConversationRef ??
        (continuity.kind === "same" ? continuity.nativeConversationRef : undefined);
      const agent =
        continuity.kind === "same" && launched.executionRef && provedReference
          ? yield* this.observeProvenExecution(
              after,
              launched.executionRef,
              harnessId,
              provedReference,
            )
          : undefined;
      if (agent) {
        if (requestedAgentName) yield* this.rename(agent, requestedAgentName);
        if (goalId) yield* this.assign(agent, goalId);
      }
      return yield* this.remember(
        {
          status: agent ? "started" : "pending",
          requestId,
          goalId,
          agentId: agent?.id,
          workspace: prepared,
          warnings: prepared.warnings,
          message: agent
            ? `Started ${harness.describe().label}${goalId ? " and assigned it to the goal" : ""}.`
            : `${launched.message} Identity remains ${continuity.kind}.`,
        },
        intentFingerprint,
        recovery,
      );
    });
  }

  resume(intent: ResumeAgentIntent): Effect.Effect<StartAgentResult, LaunchError> {
    return Effect.suspend(() => {
      if (this.resumesInFlight.has(intent.agentId))
        return Effect.fail(
          launchError("resume.in-flight", "A resume for this Agent is already in progress."),
        );
      this.resumesInFlight.add(intent.agentId);
      return Effect.gen(this, function* () {
        const requestId = yield* this.validateRequestId(intent.requestId);
        const intentFingerprint = fingerprint("resume", intent);
        const previous = yield* this.reserveReceipt(requestId, intentFingerprint);
        if (previous) return yield* this.recoverReceipt(previous);
        const saved = this.options.universe
          .snapshot()
          .agents.find((candidate) => candidate.id === intent.agentId);
        if (!saved) return yield* Effect.fail(launchError("resume.agent", "Agent not found."));
        if (!saved.harnessId || !saved.nativeConversationRef)
          return yield* Effect.fail(
            launchError("resume.agent", "The Agent has no exact native conversation to resume."),
          );
        if (!saved.worktree)
          return yield* Effect.fail(
            launchError("resume.workspace", "The Agent has no observed working directory."),
          );
        const harness = yield* this.requireHarness(saved.harnessId);
        yield* this.requireAvailable(harness);

        const before = yield* this.observeHost();
        const alreadyBound = this.options.universe
          .snapshot()
          .agents.find((agent) => agent.id === saved.id);
        if (
          alreadyBound?.executionPresence === "live" &&
          alreadyBound.nativeConversationRef &&
          sameReference(alreadyBound.nativeConversationRef, saved.nativeConversationRef)
        )
          return yield* this.remember(
            {
              status: "already-observed",
              requestId,
              goalId: saved.primaryGoalId,
              agentId: saved.id,
              message: `${harness.describe().label} already has a live execution for the exact conversation.`,
            },
            intentFingerprint,
          );
        const exactLive = before.agents.filter((observation) =>
          sameReference(
            observation.harnessEvidence?.nativeConversationRef,
            saved.nativeConversationRef!,
          ),
        );
        if (exactLive.length > 1)
          return yield* Effect.fail(
            launchError(
              "resume.conflict",
              "More than one live execution claims this provider conversation; resume is blocked.",
            ),
          );
        const alreadyLive = exactLive[0];
        if (alreadyLive) {
          const continuity = yield* this.proveResume(
            harness,
            saved.nativeConversationRef,
            alreadyLive,
          );
          if (continuity.kind === "same") {
            const rebound = yield* this.observeProvenExecution(
              before,
              alreadyLive.nativeId,
              saved.harnessId,
              saved.nativeConversationRef,
            );
            return yield* this.remember(
              {
                status: "already-observed",
                requestId,
                goalId: rebound?.primaryGoalId ?? saved.primaryGoalId,
                agentId: rebound?.id ?? saved.id,
                message: `${harness.describe().label} already restored the exact conversation.`,
              },
              intentFingerprint,
            );
          }
        }
        const ambiguousLive = before.agents.find((observation) =>
          isPlausibleUnidentifiedExecution(
            { harnessId: saved.harnessId, workspaceRef: saved.worktree },
            observation,
          ),
        );
        if (ambiguousLive)
          return yield* Effect.fail(
            launchError(
              "resume.ambiguous-execution",
              `A live ${harness.describe().label} execution in this workspace may already own the conversation, but it has no exact provider identity. Resume is blocked to prevent a duplicate.`,
            ),
          );

        const plan = yield* harness
          .planResume({
            workingDirectory: saved.worktree,
            nativeConversationRef: saved.nativeConversationRef,
            prompt: intent.prompt?.trim() || undefined,
            args: intent.args,
          })
          .pipe(Effect.mapError(mapError("harness.plan-resume")));
        const launched = yield* this.options.host
          .launchExecution({
            workingDirectory: saved.worktree,
            agentName: saved.displayName,
            processPlan: plan,
            requestId,
          })
          .pipe(Effect.mapError(mapError("host.launch-execution")));
        if (!launched.ok)
          return yield* this.remember(
            { status: "failed", requestId, message: launched.message },
            intentFingerprint,
          );
        const recovery = launched.executionRef
          ? ({
              kind: "resume",
              harnessId: saved.harnessId,
              executionRef: launched.executionRef,
              nativeConversationRef: saved.nativeConversationRef,
              goalId: saved.primaryGoalId,
              agentId: saved.id,
            } satisfies LaunchRecovery)
          : undefined;
        yield* this.remember(
          {
            status: "pending",
            requestId,
            goalId: saved.primaryGoalId,
            message: `${launched.message} Waiting for exact continuity evidence.`,
          },
          intentFingerprint,
          recovery,
        );
        const after = yield* this.observeHost();
        const observation = after.agents.find(
          (candidate) => candidate.nativeId === launched.executionRef,
        );
        const exactlyRebound = launched.executionRef
          ? this.findAgentByExecution(after.hostInstanceId, launched.executionRef)
          : undefined;
        if (
          exactlyRebound?.id === saved.id &&
          exactlyRebound.nativeConversationRef &&
          sameReference(exactlyRebound.nativeConversationRef, saved.nativeConversationRef)
        )
          return yield* this.remember(
            {
              status: "started",
              requestId,
              goalId: saved.primaryGoalId,
              agentId: saved.id,
              message: `Resumed ${saved.displayName}.`,
            },
            intentFingerprint,
            recovery,
          );
        const continuity = yield* this.proveResume(
          harness,
          saved.nativeConversationRef,
          observation,
          launched.executionRef,
        );
        const rebound =
          continuity.kind === "same" && launched.executionRef
            ? yield* this.observeProvenExecution(
                after,
                launched.executionRef,
                saved.harnessId,
                saved.nativeConversationRef,
              )
            : undefined;
        return yield* this.remember(
          {
            status: rebound?.id === saved.id ? "started" : "pending",
            requestId,
            goalId: saved.primaryGoalId,
            agentId: rebound?.id === saved.id ? saved.id : undefined,
            message:
              rebound?.id === saved.id
                ? `Resumed ${saved.displayName}.`
                : `${launched.message} Exact continuity remains ${continuity.kind}.`,
          },
          intentFingerprint,
          recovery,
        );
      }).pipe(Effect.ensuring(Effect.sync(() => this.resumesInFlight.delete(intent.agentId))));
    });
  }

  pendingLaunches(): readonly PendingLaunch[] {
    return this.receipts
      .launchReceipts()
      .filter(
        (receipt): receipt is LaunchReceipt & { readonly recovery: LaunchRecovery } =>
          receipt.result.status === "pending" &&
          receipt.recovery?.kind === "start" &&
          Boolean(receipt.recovery.executionRef),
      )
      .map((receipt) => ({
        requestId: receipt.requestId,
        harnessId: receipt.recovery.harnessId,
        executionRef: receipt.recovery.executionRef,
        displayName: receipt.recovery.displayName?.trim() || `${receipt.recovery.harnessId} agent`,
        goalId: receipt.recovery.goalId,
        message: receipt.result.message,
      }));
  }

  refreshPending(): Effect.Effect<readonly StartAgentResult[], LaunchError> {
    const receipts = this.receipts
      .launchReceipts()
      .filter((receipt) => receipt.result.status === "pending" && receipt.recovery);
    return Effect.forEach(receipts, (receipt) => this.recoverReceipt(receipt), {
      concurrency: 1,
    });
  }

  private validateRequestId(requestIdValue: string): Effect.Effect<string, LaunchError> {
    const requestId = requestIdValue.trim();
    return requestId
      ? Effect.succeed(requestId)
      : Effect.fail(launchError("launch.validate", "requestId is required."));
  }

  private reserveReceipt(
    requestId: string,
    intentFingerprint: string,
  ): Effect.Effect<LaunchReceipt | undefined, LaunchError> {
    return Effect.try({
      try: () => {
        const reservation = this.receipts.reserveLaunchReceipt({
          requestId,
          intentFingerprint,
          result: {
            status: "pending",
            requestId,
            message: "Launch request reserved; host continuity must be inspected before retry.",
          },
        });
        if (reservation.kind === "reserved") return undefined;
        if (reservation.kind === "conflict")
          throw new Error("The request id was already used for a different launch intent.");
        return reservation.receipt;
      },
      catch: (error) =>
        launchError(
          "launch.receipt",
          error instanceof Error ? error.message : "Launch receipt could not be loaded.",
        ),
    });
  }

  private remember(
    result: StartAgentResult,
    intentFingerprint: string,
    recovery?: LaunchRecovery,
  ): Effect.Effect<StartAgentResult, LaunchError> {
    return Effect.try({
      try: () => {
        this.receipts.saveLaunchReceipt({
          requestId: result.requestId,
          intentFingerprint,
          result,
          recovery,
        });
        return result;
      },
      catch: (error) =>
        launchError(
          "launch.receipt",
          error instanceof Error ? error.message : "Launch receipt could not be saved.",
        ),
    });
  }

  private recoverReceipt(receipt: LaunchReceipt): Effect.Effect<StartAgentResult, LaunchError> {
    if (receipt.result.status !== "pending" || !receipt.recovery)
      return Effect.succeed({
        ...receipt.result,
        status: "already-observed",
        message: `Request ${receipt.requestId} was already processed: ${receipt.result.message}`,
      });
    return Effect.gen(this, function* () {
      const recovery = receipt.recovery!;
      const harness = yield* this.requireHarness(recovery.harnessId);
      const snapshot = yield* this.observeHost();
      const observation = snapshot.agents.find(
        (candidate) => candidate.nativeId === recovery.executionRef,
      );
      const reconciledAgent = this.findAgentByExecution(
        snapshot.hostInstanceId,
        recovery.executionRef,
      );
      if (
        reconciledAgent &&
        (recovery.kind === "start" || reconciledAgent.id === recovery.agentId) &&
        recovery.nativeConversationRef &&
        reconciledAgent.nativeConversationRef &&
        sameReference(reconciledAgent.nativeConversationRef, recovery.nativeConversationRef)
      ) {
        if (recovery.kind === "start" && recovery.displayName)
          yield* this.rename(reconciledAgent, recovery.displayName);
        if (recovery.kind === "start" && recovery.goalId)
          yield* this.assign(reconciledAgent, recovery.goalId);
        return yield* this.remember(
          {
            ...receipt.result,
            status: "started",
            agentId: reconciledAgent.id,
            message:
              recovery.kind === "resume"
                ? `Resumed ${reconciledAgent.displayName}.`
                : `Observed and completed the original ${harness.describe().label} launch.`,
          },
          receipt.intentFingerprint,
          recovery,
        );
      }
      const continuity = yield* harness
        .proveContinuity({
          expectedNativeConversationRef: recovery.nativeConversationRef,
          observation: observationEvidence(observation),
          launchExecutionRef: recovery.executionRef,
        })
        .pipe(Effect.mapError(mapError("harness.continuity")));
      const agent =
        continuity.kind === "same" &&
        (recovery.nativeConversationRef ?? continuity.nativeConversationRef)
          ? yield* this.observeProvenExecution(
              snapshot,
              recovery.executionRef,
              recovery.harnessId,
              recovery.nativeConversationRef ?? continuity.nativeConversationRef!,
            )
          : undefined;
      const expectedAgent =
        recovery.kind === "resume" ? agent?.id === recovery.agentId : Boolean(agent);
      if (agent && expectedAgent) {
        if (recovery.kind === "start" && recovery.displayName)
          yield* this.rename(agent, recovery.displayName);
        if (recovery.kind === "start" && recovery.goalId)
          yield* this.assign(agent, recovery.goalId);
        return yield* this.remember(
          {
            ...receipt.result,
            status: "started",
            agentId: agent.id,
            message:
              recovery.kind === "resume"
                ? `Resumed ${agent.displayName}.`
                : `Observed and completed the original ${harness.describe().label} launch.`,
          },
          receipt.intentFingerprint,
          recovery,
        );
      }
      return {
        ...receipt.result,
        status: "already-observed",
        message: `Request ${receipt.requestId} remains pending; continuity is ${continuity.kind}.`,
      };
    });
  }

  private requireHarness(harnessId: string): Effect.Effect<AgentHarness, LaunchError> {
    if (!harnessId) return Effect.fail(launchError("launch.validate", "A harness id is required."));
    const harness = this.options.harnesses.agentHarness(harnessId);
    return harness
      ? Effect.succeed(harness)
      : Effect.fail(launchError("launch.harness", `Harness ${harnessId} is not enabled.`));
  }

  private requireAvailable(harness: AgentHarness): Effect.Effect<void, LaunchError> {
    return harness.availability().pipe(
      Effect.mapError(mapError("harness.availability")),
      Effect.flatMap((availability) =>
        availability.available
          ? Effect.void
          : Effect.fail(launchError("harness.availability", availability.message)),
      ),
    );
  }

  private observeHost(): Effect.Effect<HostSnapshot, LaunchError> {
    return this.options.host.snapshot().pipe(
      Effect.mapError(mapError("host.snapshot")),
      Effect.flatMap((snapshot) => {
        if (!snapshot.available)
          return Effect.fail(
            launchError("host.snapshot", snapshot.error ?? "The session host is unavailable."),
          );
        const reconciled = this.reconcileSnapshot(snapshot);
        return reconciled.accepted
          ? Effect.succeed(snapshot)
          : Effect.fail(
              launchError(
                "universe.reconcile",
                reconciled.error ?? "The host snapshot was rejected.",
              ),
            );
      }),
    );
  }

  private reconcileSnapshot(snapshot: HostSnapshot): ReconciliationResult {
    return this.options.reconcileHost
      ? this.options.reconcileHost(snapshot)
      : this.options.universe.observe({ kind: "host-executions", snapshot });
  }

  private observeProvenExecution(
    snapshot: HostSnapshot,
    executionRef: string,
    harnessId: string,
    nativeConversationRef: OpaqueNativeConversationRef,
  ): Effect.Effect<Agent | undefined, LaunchError> {
    return Effect.try({
      try: () => {
        const agents = snapshot.agents.map((observation) =>
          observation.nativeId === executionRef
            ? {
                ...observation,
                harnessEvidence: {
                  ...observation.harnessEvidence,
                  detectedHarnessId: harnessId,
                  nativeConversationRef,
                  source: observation.harnessEvidence?.source ?? ("native-integration" as const),
                  observedAt: observation.observedAt,
                },
              }
            : observation,
        );
        const result = this.reconcileSnapshot({ ...snapshot, agents });
        if (!result.accepted) throw new Error(result.error ?? "Conversation observation rejected.");
        return this.options.universe
          .snapshot()
          .agents.find(
            (agent) =>
              agent.execution?.hostInstanceId === snapshot.hostInstanceId &&
              agent.execution.nativeId === executionRef &&
              agent.nativeConversationRef &&
              sameReference(agent.nativeConversationRef, nativeConversationRef),
          );
      },
      catch: (error) =>
        launchError(
          "launch.identity",
          error instanceof Error ? error.message : "Conversation identity could not be observed.",
        ),
    });
  }

  private proveResume(
    harness: AgentHarness,
    expectedNativeConversationRef: OpaqueNativeConversationRef,
    observation?: HostAgentObservation,
    launchExecutionRef?: string,
  ): Effect.Effect<ContinuityResult, LaunchError> {
    return harness
      .proveContinuity({
        expectedNativeConversationRef,
        observation: observationEvidence(observation),
        launchExecutionRef,
      })
      .pipe(Effect.mapError(mapError("harness.continuity")));
  }

  private assign(agent: Agent, goalId: GoalId): Effect.Effect<void, LaunchError> {
    const assigned = this.options.universe.execute({
      type: "AssignAgent",
      agentId: agent.id,
      goalId,
    });
    return assigned.ok
      ? Effect.void
      : Effect.fail(
          launchError(
            "launch.assign",
            assigned.error ?? "The launched Agent could not be assigned.",
          ),
        );
  }

  private rename(agent: Agent, displayName: string): Effect.Effect<void, LaunchError> {
    const renamed = this.options.universe.execute({
      type: "RenameAgent",
      agentId: agent.id,
      displayName,
    });
    return renamed.ok
      ? Effect.void
      : Effect.fail(
          launchError("launch.rename", renamed.error ?? "The launched Agent could not be named."),
        );
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
    return result.ok && result.goalId
      ? Effect.succeed(result.goalId)
      : Effect.fail(
          launchError("launch.goal", result.error ?? "The new goal could not be created."),
        );
  }

  private findAgentByExecution(hostInstanceId: string, executionRef: string): Agent | undefined {
    return this.options.universe
      .snapshot()
      .agents.find(
        (agent) =>
          agent.execution?.hostInstanceId === hostInstanceId &&
          agent.execution.nativeId === executionRef,
      );
  }
}

export const createStartAgentCoordinator = (
  options: StartAgentCoordinatorOptions,
): StartAgentCoordinator => new DefaultStartAgentCoordinator(options);
