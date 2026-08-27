import { Effect, Schema } from "effect";
import { appendFile } from "node:fs/promises";
import type { Clock } from "../../universe/types.ts";
import type {
  HostActionResult,
  HostLaunchOption,
  HostLaunchRequest,
  HostLaunchResult,
  HostAgentObservation,
  HostSnapshot,
  OpaqueAccessTarget,
  LinkedExecution,
  AgentAccess,
  SessionHost,
  TerminalDimensions,
  TerminalOpenOptions,
  HostTerminalOpenResult,
} from "../types.ts";
import { hostError, type HostError } from "../errors.ts";
import { openHerdrTerminal, parseHerdrTerminalTarget } from "./terminal.ts";
import {
  BunCommandRunner,
  type CommandResult,
  type CommandRunner,
  type TerminalCommandRunner,
} from "./runner.ts";
import {
  isRecord,
  nonEmptyRecord,
  parseJsonValue,
  stringValue,
  type JsonRecord,
  type JsonValue,
} from "./protocol.ts";

type RecordValue = JsonRecord;
type LaunchTraceFields = Readonly<Record<string, string | number | boolean | undefined>>;
type LaunchTrace = (event: string, fields?: LaunchTraceFields) => Promise<void>;

const traceExcerpt = (value: string): string => value.trim().slice(0, 500);

const commandErrorCode = (result: CommandResult): string | undefined => {
  const payload = parseJsonValue(result.stderr) ?? parseJsonValue(result.stdout);
  if (!isRecord(payload)) return undefined;
  return stringValue(nonEmptyRecord(payload.error), "code");
};

const commandErrorMessage = (result: CommandResult): string | undefined => {
  const payload = parseJsonValue(result.stderr) ?? parseJsonValue(result.stdout);
  if (!isRecord(payload)) return undefined;
  return stringValue(nonEmptyRecord(payload.error), "message");
};

const commandFailureMessage = (result: CommandResult, fallback: string): string =>
  commandErrorMessage(result) ?? (result.stderr.trim() || result.stdout.trim() || fallback);

const createLaunchTrace = (): LaunchTrace => {
  const path = process.env.AO_LAUNCH_LOG?.trim();
  if (!path) return async () => {};
  return async (event, fields = {}) => {
    try {
      await appendFile(
        path,
        `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`,
      );
    } catch {
      // Diagnostics must never turn a host launch into a failed launch.
    }
  };
};

const stripWorkingMarker = (value: string): string => {
  const stripped = value.replace(/^[◐◓◑◒]\s*/u, "").trim();
  return stripped || value;
};
const status = (value: JsonValue | undefined): HostAgentObservation["runtimeState"] => {
  switch (value) {
    case "idle":
    case "working":
    case "waiting":
    case "blocked":
    case "done":
      return value;
    default:
      return "unknown";
  }
};

const unwrapSnapshot = (value: JsonValue | undefined): RecordValue | undefined => {
  if (!isRecord(value)) return undefined;
  const result = nonEmptyRecord(value.result);
  const snapshot = result.snapshot;
  if (isRecord(snapshot)) return snapshot;
  if (isRecord(value.snapshot)) return value.snapshot;
  return undefined;
};

const locator = (workspaceId: string, tabId: string, paneId: string, terminalId: string): string =>
  JSON.stringify({ workspaceId, tabId, paneId, terminalId });

export const parseHerdrSnapshot = (
  payload: JsonValue | undefined,
  observedAt: number,
): HostSnapshot => {
  const snapshot = unwrapSnapshot(payload);
  if (!snapshot) {
    return {
      hostKind: "herdr",
      available: false,
      observedAt,
      agents: [],
      diagnostics: ["Herdr snapshot did not contain an agent inventory result."],
      error: "Malformed Herdr snapshot envelope.",
    };
  }
  if (!Array.isArray(snapshot.panes) || !Array.isArray(snapshot.agents)) {
    const missing = [
      ...(!Array.isArray(snapshot.panes) ? ["panes"] : []),
      ...(!Array.isArray(snapshot.agents) ? ["agents"] : []),
    ];
    return {
      hostKind: "herdr",
      available: false,
      observedAt,
      agents: [],
      diagnostics: [`Herdr snapshot omitted required ${missing.join(" and ")} array(s).`],
      error: "Malformed Herdr snapshot: required agent inventory is incomplete.",
    };
  }
  const panes = snapshot.panes;
  const agentRecords = snapshot.agents;
  const workspaces = Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [];
  const paneById = new Map<string, RecordValue>();
  const workspaceById = new Map<string, RecordValue>();
  const diagnostics: string[] = [];
  for (const item of panes) {
    const record = nonEmptyRecord(item);
    const paneId = stringValue(record, "pane_id");
    if (paneId) paneById.set(paneId, record);
  }
  for (const item of workspaces) {
    const record = nonEmptyRecord(item);
    const workspaceId = stringValue(record, "workspace_id");
    if (workspaceId) workspaceById.set(workspaceId, record);
  }

  const observations: HostAgentObservation[] = [];
  const seen = new Set<string>();
  for (const item of agentRecords) {
    if (!isRecord(item)) {
      diagnostics.push("Skipped a non-object Herdr agent record.");
      continue;
    }
    const paneId = stringValue(item, "pane_id");
    const pane = paneId ? (paneById.get(paneId) ?? {}) : {};
    const workspaceId = stringValue(item, "workspace_id") ?? stringValue(pane, "workspace_id");
    const tabId = stringValue(item, "tab_id") ?? stringValue(pane, "tab_id");
    const terminalId = stringValue(item, "terminal_id") ?? stringValue(pane, "terminal_id");
    if (!paneId || !workspaceId || !tabId || !terminalId) {
      diagnostics.push("Skipped a Herdr agent without its opaque pane identity fields.");
      continue;
    }
    if (seen.has(paneId)) diagnostics.push(`Found duplicate Herdr agent pane ${paneId}.`);
    else seen.add(paneId);
    const workspace = workspaceById.get(workspaceId) ?? {};
    const worktree = nonEmptyRecord(workspace.worktree);
    const displayName = stripWorkingMarker(
      stringValue(item, "name") ??
        stringValue(item, "title") ??
        stringValue(item, "terminal_title_stripped") ??
        stringValue(pane, "terminal_title_stripped") ??
        stringValue(item, "label") ??
        stringValue(workspace, "label") ??
        paneId,
    );
    const repository = stringValue(worktree, "repo_name");
    const worktreePath = stringValue(worktree, "checkout_path");
    const branch = stringValue(worktree, "branch");
    const provider = stringValue(item, "display_agent") ?? stringValue(item, "agent");
    const executionContainerLabel = stringValue(workspace, "label");
    const observedState = status(item.agent_status ?? pane.agent_status);
    const observation = {
      nativeId: paneId,
      displayName,
      runtimeState: observedState,
      runtimeStateSource: "herdr.agent_status",
      observedAt,
      hostLocator: locator(workspaceId, tabId, paneId, terminalId),
      executionContainer: executionContainerLabel
        ? { id: workspaceId, label: executionContainerLabel }
        : { id: workspaceId },
    };
    if (repository) Object.assign(observation, { repository });
    if (branch) Object.assign(observation, { branch });
    if (worktreePath) Object.assign(observation, { worktree: worktreePath });
    if (provider) Object.assign(observation, { provider });
    observations.push(observation);
  }
  if (!Array.isArray(snapshot.workspaces))
    diagnostics.push("Herdr snapshot omitted its optional workspaces array.");
  return {
    hostKind: "herdr",
    available: true,
    observedAt,
    agents: observations,
    diagnostics,
  };
};

const parseTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "herdr-agent-attach" ? target.token : undefined;

const normalizedPath = (value: string): string => value.replace(/\\/gu, "/").replace(/\/+$/u, "");

const paneWorkingDirectory = (pane: RecordValue): string | undefined =>
  stringValue(pane, "cwd") ?? stringValue(pane, "foreground_cwd");

const terminalFingerprintForPane = (pane: RecordValue): string | undefined => {
  const workspaceId = stringValue(pane, "workspace_id");
  const tabId = stringValue(pane, "tab_id");
  const paneId = stringValue(pane, "pane_id");
  const terminalId = stringValue(pane, "terminal_id");
  if (!workspaceId || !tabId || !paneId || !terminalId) return undefined;
  return JSON.stringify({ workspaceId, tabId, paneId, terminalId });
};

const herdrTarget = (
  kind: string,
  token: string,
  fingerprint: string | undefined,
): OpaqueAccessTarget => {
  const target = { kind, token };
  if (fingerprint) return { ...target, fingerprint };
  return target;
};

const openLinkedExecutionTerminalTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "herdr-terminal-control" ? target.token : undefined;

const preparedShellWorkingDirectory = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "herdr-prepared-shell" ? target.token : undefined;

const paneWorkingDirectoriesFor = (payload: JsonValue | undefined): Map<string, string> => {
  const snapshot = unwrapSnapshot(payload);
  const panes = snapshot && Array.isArray(snapshot.panes) ? snapshot.panes : [];
  const result = new Map<string, string>();
  for (const item of panes) {
    const pane = nonEmptyRecord(item);
    const paneId = stringValue(pane, "pane_id");
    const workingDirectory = paneWorkingDirectory(pane);
    if (paneId && workingDirectory) result.set(paneId, normalizedPath(workingDirectory));
  }
  return result;
};

const paneWorkspaceIdsFor = (payload: JsonValue | undefined): Map<string, string> => {
  const snapshot = unwrapSnapshot(payload);
  const panes = snapshot && Array.isArray(snapshot.panes) ? snapshot.panes : [];
  const result = new Map<string, string>();
  for (const item of panes) {
    const pane = nonEmptyRecord(item);
    const paneId = stringValue(pane, "pane_id");
    const workspaceId = stringValue(pane, "workspace_id");
    if (paneId && workspaceId) result.set(paneId, workspaceId);
  }
  const agents = snapshot && Array.isArray(snapshot.agents) ? snapshot.agents : [];
  for (const item of agents) {
    const agent = nonEmptyRecord(item);
    const paneId = stringValue(agent, "pane_id");
    const workspaceId = stringValue(agent, "workspace_id");
    if (paneId && workspaceId && !result.has(paneId)) result.set(paneId, workspaceId);
  }
  return result;
};

const paneFingerprintsFor = (payload: JsonValue | undefined): Map<string, string> => {
  const snapshot = unwrapSnapshot(payload);
  const panes = snapshot && Array.isArray(snapshot.panes) ? snapshot.panes : [];
  const result = new Map<string, string>();
  for (const item of panes) {
    const pane = nonEmptyRecord(item);
    const paneId = stringValue(pane, "pane_id");
    const fingerprint = terminalFingerprintForPane(pane);
    if (paneId && fingerprint) result.set(paneId, fingerprint);
  }
  return result;
};

const newPaneFor = (
  payload: JsonValue | undefined,
  beforePaneIds: ReadonlySet<string>,
  workingDirectory: string,
  workspaceId?: string,
): string | undefined => {
  const wanted = normalizedPath(workingDirectory);
  const snapshot = unwrapSnapshot(payload);
  const panes = snapshot && Array.isArray(snapshot.panes) ? snapshot.panes : [];
  const agentPaneIds = new Set(
    (snapshot && Array.isArray(snapshot.agents) ? snapshot.agents : [])
      .map((agent) => (isRecord(agent) ? stringValue(agent, "pane_id") : undefined))
      .filter((paneId): paneId is string => Boolean(paneId)),
  );
  const candidates = panes
    .map(nonEmptyRecord)
    .map((pane) => ({
      paneId: stringValue(pane, "pane_id"),
      workspaceId: stringValue(pane, "workspace_id"),
      workingDirectory: paneWorkingDirectory(pane),
    }))
    .filter(
      (
        pane,
      ): pane is { paneId: string; workspaceId: string | undefined; workingDirectory: string } => {
        const paneId = pane.paneId;
        const candidateWorkingDirectory = pane.workingDirectory;
        return (
          paneId !== undefined &&
          candidateWorkingDirectory !== undefined &&
          (workspaceId === undefined || pane.workspaceId === workspaceId) &&
          !beforePaneIds.has(paneId) &&
          !agentPaneIds.has(paneId) &&
          normalizedPath(candidateWorkingDirectory) === wanted
        );
      },
    );
  return candidates.length === 1 ? candidates[0]?.paneId : undefined;
};

/**
 * Observe shell-only panes as transient linkedExecutions to their matching agent.
 * The returned values deliberately contain only opaque terminal targets; the
 * Herdr workspace/tab/pane topology stays inside this adapter.
 */
const linkedExecutionsFor = (
  payload: JsonValue | undefined,
  agents: readonly HostAgentObservation[],
): Map<string, readonly LinkedExecution[]> => {
  const snapshot = unwrapSnapshot(payload);
  const linkedExecutions = new Map<string, readonly LinkedExecution[]>();
  if (!snapshot || !Array.isArray(snapshot.panes)) return linkedExecutions;

  const panes = snapshot.panes.map(nonEmptyRecord);
  const paneById = new Map<string, RecordValue>();
  for (const pane of panes) {
    const paneId = stringValue(pane, "pane_id");
    if (paneId) paneById.set(paneId, pane);
  }
  const agentPaneIds = new Set(
    (Array.isArray(snapshot.agents) ? snapshot.agents : [])
      .map((agent) => (isRecord(agent) ? stringValue(agent, "pane_id") : undefined))
      .filter((paneId): paneId is string => Boolean(paneId)),
  );

  for (const agent of agents) {
    const agentPane = paneById.get(agent.nativeId);
    const workspaceId = agentPane ? stringValue(agentPane, "workspace_id") : undefined;
    const workingDirectory =
      agent.worktree ?? (agentPane ? paneWorkingDirectory(agentPane) : undefined);
    const ownerFingerprint = agentPane ? terminalFingerprintForPane(agentPane) : undefined;
    const wanted = workingDirectory ? normalizedPath(workingDirectory) : undefined;
    const observed = panes
      .filter((pane) => {
        const paneId = stringValue(pane, "pane_id");
        const paneWorkspaceId = stringValue(pane, "workspace_id");
        const paneCwd = paneWorkingDirectory(pane);
        return (
          Boolean(paneId) &&
          paneId !== agent.nativeId &&
          Boolean(workspaceId) &&
          paneWorkspaceId === workspaceId &&
          Boolean(wanted) &&
          Boolean(paneCwd) &&
          normalizedPath(paneCwd!) === wanted
        );
      })
      .map((pane, index): LinkedExecution | undefined => {
        const paneId = stringValue(pane, "pane_id");
        if (!paneId) return undefined;
        const title =
          stringValue(pane, "terminal_title_stripped") ??
          stringValue(pane, "terminal_title") ??
          `Linked terminal ${index + 1}`;
        const fingerprint = terminalFingerprintForPane(pane);
        return {
          kind: agentPaneIds.has(paneId) ? "agent" : "shell",
          label: stripWorkingMarker(title),
          owner: herdrTarget("herdr-agent-attach", agent.nativeId, ownerFingerprint),
          workingDirectory,
          target: fingerprint
            ? { kind: "herdr-terminal-control", token: paneId, fingerprint }
            : undefined,
          available: fingerprint !== undefined,
          source: "observed",
          explanation: fingerprint
            ? agentPaneIds.has(paneId)
              ? "Sibling Herdr agent in the same worktree."
              : "Existing Herdr shell in the agent worktree."
            : "Herdr did not provide a complete terminal identity for this linked pane.",
        };
      })
      .filter(
        (linkedExecution): linkedExecution is LinkedExecution => linkedExecution !== undefined,
      );

    if (workingDirectory) {
      linkedExecutions.set(agent.nativeId, [
        ...observed,
        {
          kind: "shell",
          label: "New terminal",
          owner: herdrTarget("herdr-agent-attach", agent.nativeId, ownerFingerprint),
          workingDirectory,
          target: { kind: "herdr-prepared-shell", token: workingDirectory },
          available: true,
          source: "prepared",
          explanation: `Create a new Herdr terminal tab in ${workingDirectory}.`,
        },
      ]);
    } else if (observed.length > 0) {
      linkedExecutions.set(agent.nativeId, observed);
    }
  }
  return linkedExecutions;
};

const launchPaneFor = (
  payload: JsonValue | undefined,
  workingDirectory: string,
): string | undefined => {
  const snapshot = unwrapSnapshot(payload);
  if (!snapshot || !Array.isArray(snapshot.panes)) return undefined;
  const agentPaneIds = new Set(
    (Array.isArray(snapshot.agents) ? snapshot.agents : [])
      .map((agent) => (isRecord(agent) ? stringValue(agent, "pane_id") : undefined))
      .filter((paneId): paneId is string => Boolean(paneId)),
  );
  const wanted = normalizedPath(workingDirectory);
  for (const item of snapshot.panes) {
    const pane = nonEmptyRecord(item);
    const paneId = stringValue(pane, "pane_id");
    const cwd = paneWorkingDirectory(pane);
    if (paneId && cwd && normalizedPath(cwd) === wanted && !agentPaneIds.has(paneId)) return paneId;
  }
  return undefined;
};

const createdRootPaneId = (payload: JsonValue | undefined): string | undefined => {
  if (!isRecord(payload)) return undefined;
  const result = nonEmptyRecord(payload.result);
  const rootPane = result.root_pane;
  if (Schema.is(Schema.String)(rootPane) && rootPane.trim()) return rootPane.trim();
  if (!isRecord(rootPane)) return stringValue(result, "root_pane_id");
  return stringValue(rootPane, "pane_id") ?? stringValue(rootPane, "id");
};

const generatedAgentName = (agentKind: string, requestId: string): string => {
  const kind =
    agentKind
      .toLocaleLowerCase()
      .replace(/[^a-z0-9_-]/gu, "-")
      .replace(/^[^a-z]+/u, "") || "agent";
  const suffix =
    requestId
      .toLocaleLowerCase()
      .replace(/[^a-z0-9_-]/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(-24) || "launch";
  return `${kind.slice(0, Math.max(1, 31 - suffix.length))}-${suffix}`;
};

const paneBusy = (result: CommandResult): boolean => {
  return commandErrorCode(result) === "agent_pane_busy";
};

const startAgentAfter = async (
  runner: CommandRunner,
  args: readonly string[],
  delays: readonly number[],
  trace: LaunchTrace,
  paneId: string,
  attempt: number,
): Promise<CommandResult> => {
  await trace("agent.start.attempt", { attempt, paneId });
  const result = await runner.run(args);
  await trace("agent.start.result", {
    attempt,
    paneId,
    exitCode: result.exitCode,
    errorCode: commandErrorCode(result),
    stderr: traceExcerpt(result.stderr),
  });
  const delayMs = delays[0];
  if (!paneBusy(result) || delayMs === undefined) return result;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return startAgentAfter(runner, args, delays.slice(1), trace, paneId, attempt + 1);
};

const startAgent = (
  runner: CommandRunner,
  args: readonly string[],
  trace: LaunchTrace,
  paneId: string,
): Promise<CommandResult> =>
  startAgentAfter(runner, args, [100, 200, 400, 800, 1_200, 1_600, 2_000], trace, paneId, 1);

const HERDR_LAUNCH_OPTIONS: readonly HostLaunchOption[] = [
  { kind: "claude", label: "Claude Code", description: "Claude Code CLI" },
  { kind: "codex", label: "Codex", description: "Codex CLI" },
  { kind: "pi", label: "Pi", description: "Pi coding agent" },
];

export class HerdrHostAdapter implements SessionHost {
  private readonly runner: CommandRunner;
  private readonly terminalRunner: TerminalCommandRunner | undefined;
  private readonly clock: Clock;
  private readonly liveTargets = new Map<string, OpaqueAccessTarget>();
  private readonly liveLinkedExecutions = new Map<string, readonly LinkedExecution[]>();
  private readonly livePaneWorkingDirectories = new Map<string, string>();
  private readonly livePaneWorkspaces = new Map<string, string>();
  private readonly liveTerminalFingerprints = new Map<string, string>();
  private readonly liveAgentFingerprints = new Map<string, string>();

  constructor(options: {
    readonly runner?: CommandRunner;
    readonly terminalRunner?: TerminalCommandRunner;
    readonly clock: Clock;
  }) {
    const runner = options.runner ?? new BunCommandRunner();
    this.runner = runner;
    this.terminalRunner =
      options.terminalRunner ?? (runner instanceof BunCommandRunner ? runner : undefined);
    this.clock = options.clock;
  }

  snapshot(): Effect.Effect<HostSnapshot, HostError> {
    return Effect.tryPromise({
      try: () => this.snapshotInternal(),
      catch: () => hostError("host.snapshot", "Herdr snapshot failed unexpectedly."),
    });
  }

  listLaunchOptions(): Effect.Effect<readonly HostLaunchOption[], HostError> {
    return Effect.succeed(HERDR_LAUNCH_OPTIONS);
  }

  launch(request: HostLaunchRequest): Effect.Effect<HostLaunchResult, HostError> {
    return Effect.tryPromise({
      try: async () => {
        const trace = createLaunchTrace();
        const workingDirectory = request.workingDirectory.trim();
        const agentKind = request.agentKind.trim();
        await trace("launch.begin", {
          requestId: request.requestId,
          workingDirectory,
          agentKind,
          agentName: request.agentName?.trim(),
          promptProvided: Boolean(request.prompt?.trim()),
        });
        if (!workingDirectory) return { ok: false, message: "A working directory is required." };
        if (!agentKind) return { ok: false, message: "An agent kind is required." };
        const before = await this.snapshotInternal();
        await trace("launch.before-snapshot", {
          available: before.available,
          agentCount: before.agents.length,
          error: before.error,
        });
        const workspaceLabel = request.agentName?.trim() || `${agentKind} agent`;
        const workspace = await this.runner.run([
          "herdr",
          "workspace",
          "create",
          "--cwd",
          workingDirectory,
          "--label",
          workspaceLabel,
          "--no-focus",
        ]);
        const workspaceRootPaneId = createdRootPaneId(parseJsonValue(workspace.stdout));
        await trace("workspace.create.result", {
          exitCode: workspace.exitCode,
          errorCode: commandErrorCode(workspace),
          stderr: traceExcerpt(workspace.stderr),
          rootPaneId: workspaceRootPaneId,
        });
        if (workspace.exitCode !== 0)
          return {
            ok: false,
            message: commandFailureMessage(workspace, "Herdr could not create a launch workspace."),
          };
        let paneId = workspaceRootPaneId;
        if (!paneId) {
          const workspaceSnapshot = await this.runner.run(["herdr", "api", "snapshot"]);
          await trace("workspace.snapshot.result", {
            exitCode: workspaceSnapshot.exitCode,
            errorCode: commandErrorCode(workspaceSnapshot),
            stderr: traceExcerpt(workspaceSnapshot.stderr),
          });
          if (workspaceSnapshot.exitCode !== 0)
            return {
              ok: false,
              message: commandFailureMessage(
                workspaceSnapshot,
                "Herdr could not inspect the launch workspace.",
              ),
            };
          paneId = launchPaneFor(parseJsonValue(workspaceSnapshot.stdout), workingDirectory);
        }
        if (!paneId) await trace("workspace.pane.missing", { workingDirectory });
        if (!paneId)
          return {
            ok: false,
            message: "Herdr created the workspace but no interactive shell pane was found.",
          };
        const name =
          request.agentName?.trim() || generatedAgentName(agentKind, request.requestId.trim());
        const args = [
          "herdr",
          "agent",
          "start",
          name,
          "--kind",
          agentKind,
          "--pane",
          paneId,
          "--timeout",
          "30000",
          ...(request.args && request.args.length > 0 ? ["--", ...request.args] : []),
        ];
        const started = await startAgent(this.runner, args, trace, paneId);
        if (started.exitCode !== 0)
          return {
            ok: false,
            message: commandFailureMessage(started, `Herdr could not start ${agentKind}.`),
          };
        let promptWarning = "";
        if (request.prompt?.trim()) {
          const prompted = await this.runner.run([
            "herdr",
            "agent",
            "prompt",
            paneId,
            request.prompt.trim(),
          ]);
          await trace("agent.prompt.result", {
            exitCode: prompted.exitCode,
            errorCode: commandErrorCode(prompted),
            stderr: traceExcerpt(prompted.stderr),
            promptProvided: true,
          });
          if (prompted.exitCode !== 0)
            promptWarning = commandFailureMessage(
              prompted,
              "Initial prompt could not be delivered.",
            );
        }
        const after = await this.snapshotInternal();
        await trace("launch.after-snapshot", {
          available: after.available,
          agentCount: after.agents.length,
          error: after.error,
        });
        const beforeIds = new Set(before.agents.map((agent) => agent.nativeId));
        const candidate = after.agents.find(
          (agent) =>
            !beforeIds.has(agent.nativeId) &&
            (agent.nativeId === paneId ||
              agent.displayName === name ||
              agent.worktree === workingDirectory),
        );
        return {
          ok: true,
          nativeId: candidate?.nativeId,
          message: candidate
            ? `Started ${agentKind} in Herdr${promptWarning ? ` · warning: ${promptWarning}` : ""}.`
            : `Started ${agentKind} in Herdr; waiting for the new agent to appear${promptWarning ? ` · warning: ${promptWarning}` : ""}.`,
        };
      },
      catch: (error) =>
        hostError("host.launch", error instanceof Error ? error.message : String(error)),
    });
  }

  private async snapshotInternal(): Promise<HostSnapshot> {
    this.liveTargets.clear();
    this.liveLinkedExecutions.clear();
    this.livePaneWorkingDirectories.clear();
    this.livePaneWorkspaces.clear();
    this.liveTerminalFingerprints.clear();
    this.liveAgentFingerprints.clear();
    let result;
    try {
      result = await this.runner.run(["herdr", "api", "snapshot"]);
    } catch (error) {
      return {
        hostKind: "herdr",
        available: false,
        observedAt: this.clock.now(),
        agents: [],
        diagnostics: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.exitCode !== 0) {
      return {
        hostKind: "herdr",
        available: false,
        observedAt: this.clock.now(),
        agents: [],
        diagnostics: [],
        error: commandFailureMessage(result, `Herdr exited with ${result.exitCode}.`),
      };
    }
    const parsedPayload = parseJsonValue(result.stdout);
    const snapshot = parseHerdrSnapshot(parsedPayload, this.clock.now());
    if (!snapshot.available) return snapshot;
    for (const [paneId, workingDirectory] of paneWorkingDirectoriesFor(parsedPayload))
      this.livePaneWorkingDirectories.set(paneId, workingDirectory);
    for (const [paneId, workspaceId] of paneWorkspaceIdsFor(parsedPayload))
      this.livePaneWorkspaces.set(paneId, workspaceId);
    for (const [paneId, fingerprint] of paneFingerprintsFor(parsedPayload))
      this.liveTerminalFingerprints.set(paneId, fingerprint);
    const linkedExecutions = linkedExecutionsFor(parsedPayload, snapshot.agents);
    this.liveTargets.clear();
    const nativeIds = new Set<string>();
    const ambiguous = snapshot.agents.some((agent) => {
      if (nativeIds.has(agent.nativeId)) return true;
      nativeIds.add(agent.nativeId);
      return false;
    });
    if (!ambiguous)
      for (const agent of snapshot.agents) {
        const fingerprint = this.liveTerminalFingerprints.get(agent.nativeId);
        if (fingerprint) this.liveAgentFingerprints.set(agent.nativeId, fingerprint);
        this.liveTargets.set(
          agent.nativeId,
          herdrTarget("herdr-agent-attach", agent.nativeId, fingerprint),
        );
        const agentLinkedExecutions = linkedExecutions.get(agent.nativeId);
        if (agentLinkedExecutions)
          this.liveLinkedExecutions.set(agent.nativeId, agentLinkedExecutions);
      }
    return snapshot;
  }

  access(agentRef: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Effect.Effect<AgentAccess, HostError> {
    return Effect.sync(() => {
      if (agentRef.hostKind !== "herdr")
        return {
          supported: false,
          capabilities: [],
          linkedExecutions: [],
          explanation: "This agent belongs to an unsupported host.",
        } satisfies AgentAccess;
      const target = this.liveTargets.get(agentRef.nativeId);
      if (!target)
        return {
          supported: false,
          capabilities: [],
          linkedExecutions: [],
          explanation: "The agent is not present in the latest Herdr snapshot.",
        } satisfies AgentAccess;
      const linkedExecutions = this.liveLinkedExecutions.get(agentRef.nativeId) ?? [];
      const fingerprint = this.liveAgentFingerprints.get(agentRef.nativeId);
      return {
        supported: true,
        capabilities: [
          ...(fingerprint ? ["embedded-terminal" as const] : []),
          "native-handoff",
          ...(fingerprint ? ["close-agent" as const] : []),
          ...(linkedExecutions.some((linkedExecution) => linkedExecution.available)
            ? ["linked-terminal" as const]
            : []),
        ],
        mode: "attach",
        target,
        terminalTarget: fingerprint
          ? { kind: "herdr-terminal-control", token: agentRef.nativeId, fingerprint }
          : undefined,
        linkedExecutions,
        explanation: "Attach directly or open an embedded terminal for the running Herdr agent.",
      } satisfies AgentAccess;
    });
  }

  private currentLinkedExecution(execution: LinkedExecution): LinkedExecution | undefined {
    const ownerToken = parseTarget(execution.owner);
    if (!ownerToken) return undefined;
    const desiredToken = execution.target
      ? openLinkedExecutionTerminalTarget(execution.target)
      : undefined;
    return (this.liveLinkedExecutions.get(ownerToken) ?? []).find((candidate) => {
      const candidateToken = candidate.target
        ? openLinkedExecutionTerminalTarget(candidate.target)
        : undefined;
      return (
        candidate.kind === execution.kind &&
        candidate.source === execution.source &&
        candidateToken === desiredToken &&
        candidate.target?.fingerprint === execution.target?.fingerprint &&
        normalizedPath(candidate.workingDirectory ?? "") ===
          normalizedPath(execution.workingDirectory ?? "")
      );
    });
  }

  activate(access: AgentAccess): Effect.Effect<HostActionResult, HostError> {
    return Effect.tryPromise({
      try: async () => {
        if (!access.supported || !access.target) return { ok: false, message: access.explanation };
        const token = parseTarget(access.target);
        if (!token)
          return {
            ok: false,
            message: "The Herdr attachment target is invalid or unsupported.",
          };
        const snapshot = await this.snapshotInternal();
        if (
          !snapshot.available ||
          !this.liveTargets.has(token) ||
          !access.target.fingerprint ||
          this.liveAgentFingerprints.get(token) !== access.target.fingerprint
        )
          return {
            ok: false,
            message: snapshot.error ?? "The Herdr agent target is no longer available.",
          };
        const result = await this.runner.run(["herdr", "agent", "attach", token], {
          interactive: true,
        });
        if (result.exitCode !== 0)
          return {
            ok: false,
            message: result.stderr.trim() || `Herdr could not attach to ${token}.`,
          };
        return { ok: true, message: `Attached to the real Herdr agent ${token}.` };
      },
      catch: () => hostError("host.activate", "Herdr could not attach to the agent."),
    });
  }

  closeAgent(access: AgentAccess): Effect.Effect<HostActionResult, HostError> {
    return Effect.tryPromise({
      try: async () => {
        if (!access.supported || !access.target) return { ok: false, message: access.explanation };
        if (!access.capabilities.includes("close-agent"))
          return {
            ok: false,
            message: "This Herdr agent does not expose a safe close capability.",
          };
        const token = parseTarget(access.target);
        if (!token || !access.target.fingerprint)
          return { ok: false, message: "The Herdr close target is invalid or unsupported." };
        const snapshot = await this.snapshotInternal();
        if (!snapshot.available)
          return {
            ok: false,
            message: snapshot.error ?? "Herdr is unavailable; the Agent lifecycle is uncertain.",
          };
        const current = this.liveTargets.get(token);
        if (!current) return { ok: true, message: `Herdr agent ${token} had already ended.` };
        if (current.fingerprint !== access.target.fingerprint)
          return {
            ok: false,
            message: "The Herdr Agent target changed before close; no process was stopped.",
          };
        const result = await this.runner.run(["herdr", "pane", "close", token]);
        if (result.exitCode !== 0)
          return {
            ok: false,
            message: commandFailureMessage(result, `Herdr could not close ${token}.`),
          };
        return { ok: true, message: `Closed Herdr agent ${token}.` };
      },
      catch: (error) =>
        hostError("host.closeAgent", error instanceof Error ? error.message : String(error)),
    });
  }

  openTerminal(
    access: AgentAccess,
    dimensions: TerminalDimensions,
    options?: TerminalOpenOptions,
  ): Effect.Effect<HostTerminalOpenResult, HostError> {
    return Effect.tryPromise({
      try: async () => {
        if (!access.supported || !access.terminalTarget)
          return {
            ok: false,
            message: "This agent does not expose an embedded Herdr terminal.",
          } satisfies HostTerminalOpenResult;
        if (!this.terminalRunner)
          return {
            ok: false,
            message: "The configured Herdr command runner cannot stream terminals.",
          } satisfies HostTerminalOpenResult;
        const token = parseHerdrTerminalTarget(access.terminalTarget);
        if (!token)
          return {
            ok: false,
            message: "The Herdr terminal target is invalid or unsupported.",
          } satisfies HostTerminalOpenResult;
        const snapshot = await this.snapshotInternal();
        if (
          !snapshot.available ||
          !this.liveTargets.has(token) ||
          !access.terminalTarget.fingerprint ||
          this.liveTerminalFingerprints.get(token) !== access.terminalTarget.fingerprint
        )
          return {
            ok: false,
            message: snapshot.error ?? "The Herdr terminal target is no longer available.",
          } satisfies HostTerminalOpenResult;
        try {
          return {
            ok: true,
            terminal: openHerdrTerminal(this.terminalRunner, token, dimensions, options),
            message: `Opened an embedded Herdr terminal for ${token}.`,
          } satisfies HostTerminalOpenResult;
        } catch (error) {
          return {
            ok: false,
            message: `Could not open the Herdr terminal: ${error instanceof Error ? error.message : String(error)}`,
          } satisfies HostTerminalOpenResult;
        }
      },
      catch: (error) =>
        hostError("host.openTerminal", error instanceof Error ? error.message : String(error)),
    });
  }

  openLinkedExecutionTerminal(
    linkedExecution: LinkedExecution,
    dimensions: TerminalDimensions,
    options?: TerminalOpenOptions,
  ): Effect.Effect<HostTerminalOpenResult, HostError> {
    return Effect.tryPromise({
      try: async () => {
        if (!linkedExecution.available || !linkedExecution.target)
          return {
            ok: false,
            message: linkedExecution.explanation,
          } satisfies HostTerminalOpenResult;
        if (!this.terminalRunner)
          return {
            ok: false,
            message: "The configured Herdr command runner cannot stream linked terminals.",
          } satisfies HostTerminalOpenResult;

        const snapshot = await this.snapshotInternal();
        if (!snapshot.available)
          return {
            ok: false,
            message: snapshot.error ?? "Herdr is unavailable; the linked execution is uncertain.",
          } satisfies HostTerminalOpenResult;

        const ownerToken = parseTarget(linkedExecution.owner);
        if (!ownerToken)
          return {
            ok: false,
            message: "The Herdr linked execution owner is invalid or unsupported.",
          } satisfies HostTerminalOpenResult;
        const ownerTarget = this.liveTargets.get(ownerToken);
        if (
          !ownerTarget ||
          (linkedExecution.owner.fingerprint !== undefined &&
            ownerTarget.fingerprint !== linkedExecution.owner.fingerprint)
        )
          return {
            ok: false,
            message: "The linked execution's parent Agent is no longer available.",
          } satisfies HostTerminalOpenResult;

        const workingDirectory = preparedShellWorkingDirectory(linkedExecution.target);
        const currentExecution = workingDirectory
          ? undefined
          : this.currentLinkedExecution(linkedExecution);
        let target = currentExecution?.target
          ? openLinkedExecutionTerminalTarget(currentExecution.target)
          : undefined;
        let targetFingerprint = currentExecution?.target?.fingerprint;
        if (workingDirectory) {
          // A prepared companion is a contextual Herdr tab, not a new AO
          // workspace. Keep the parent workspace identity inside this adapter.
          const ownerWorkspaceId = this.livePaneWorkspaces.get(ownerToken);
          if (!ownerWorkspaceId)
            return {
              ok: false,
              message: "Herdr could not identify the Agent workspace for a linked terminal tab.",
            } satisfies HostTerminalOpenResult;
          const beforePaneIds = new Set(this.livePaneWorkingDirectories.keys());
          const created = await this.runner.run([
            "herdr",
            "tab",
            "create",
            "--workspace",
            ownerWorkspaceId,
            "--cwd",
            workingDirectory,
            "--label",
            "AO linked terminal",
            "--no-focus",
          ]);
          if (created.exitCode !== 0)
            return {
              ok: false,
              message: commandFailureMessage(
                created,
                "Herdr could not prepare a linked terminal tab.",
              ),
            } satisfies HostTerminalOpenResult;
          target = createdRootPaneId(parseJsonValue(created.stdout));
          const afterCreate = await this.runner.run(["herdr", "api", "snapshot"]);
          if (afterCreate.exitCode === 0) {
            const afterPayload = parseJsonValue(afterCreate.stdout);
            const afterFingerprints = paneFingerprintsFor(afterPayload);
            const afterWorkspaces = paneWorkspaceIdsFor(afterPayload);
            if (target) {
              const afterCwd = paneWorkingDirectoriesFor(afterPayload).get(target);
              targetFingerprint = afterFingerprints.get(target);
              if (
                afterCwd !== normalizedPath(workingDirectory) ||
                afterWorkspaces.get(target) !== ownerWorkspaceId ||
                targetFingerprint === undefined
              )
                target = undefined;
            }
            if (!target) {
              target = newPaneFor(afterPayload, beforePaneIds, workingDirectory, ownerWorkspaceId);
              targetFingerprint = target ? afterFingerprints.get(target) : undefined;
            }
          }
          if (!target || !targetFingerprint)
            return {
              ok: false,
              message: "Herdr created a linked terminal tab but could not identify its shell pane.",
            } satisfies HostTerminalOpenResult;
        }
        if (!target || !targetFingerprint)
          return {
            ok: false,
            message: currentExecution
              ? "The Herdr linked terminal target is invalid or unsupported."
              : "The selected linked execution is no longer available.",
          } satisfies HostTerminalOpenResult;
        return {
          ok: true,
          terminal: openHerdrTerminal(this.terminalRunner, target, dimensions, options),
          message: workingDirectory
            ? `Opened a Herdr linked terminal tab in ${workingDirectory}.`
            : `Opened the existing Herdr linked terminal ${target}.`,
        } satisfies HostTerminalOpenResult;
      },
      catch: (error) =>
        hostError(
          "host.openLinkedExecutionTerminal",
          error instanceof Error ? error.message : String(error),
        ),
    });
  }
}
