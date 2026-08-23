import { Effect, Schema } from "effect";
import { appendFile } from "node:fs/promises";
import type { Clock } from "../../universe/types.ts";
import type {
  HostActionResult,
  HostLaunchOption,
  HostLaunchRequest,
  HostLaunchResult,
  HostSessionObservation,
  HostSnapshot,
  OpaqueAccessTarget,
  SessionAccess,
  SessionHost,
  TerminalDimensions,
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
const status = (value: JsonValue | undefined): HostSessionObservation["runtimeState"] => {
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
      sessions: [],
      diagnostics: ["Herdr snapshot did not contain a session_snapshot result."],
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
      sessions: [],
      diagnostics: [`Herdr snapshot omitted required ${missing.join(" and ")} array(s).`],
      error: "Malformed Herdr snapshot: required session inventory is incomplete.",
    };
  }
  const panes = snapshot.panes;
  const agents = snapshot.agents;
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

  const sessions: HostSessionObservation[] = [];
  const seen = new Set<string>();
  for (const item of agents) {
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
    const observedState = status(item.agent_status ?? pane.agent_status);
    const observation = {
      nativeId: paneId,
      displayName,
      runtimeState: observedState,
      runtimeStateSource: "herdr.agent_status",
      observedAt,
      hostLocator: locator(workspaceId, tabId, paneId, terminalId),
    };
    if (repository) Object.assign(observation, { repository });
    if (branch) Object.assign(observation, { branch });
    if (worktreePath) Object.assign(observation, { worktree: worktreePath });
    if (provider) Object.assign(observation, { provider });
    sessions.push(observation);
  }
  if (!Array.isArray(snapshot.workspaces))
    diagnostics.push("Herdr snapshot omitted its optional workspaces array.");
  return {
    hostKind: "herdr",
    available: true,
    observedAt,
    sessions,
    diagnostics,
  };
};

const parseTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "herdr-agent-attach" ? target.token : undefined;

const normalizedPath = (value: string): string => value.replace(/\\/gu, "/").replace(/\/+$/u, "");

const paneWorkingDirectory = (pane: RecordValue): string | undefined =>
  stringValue(pane, "cwd") ?? stringValue(pane, "foreground_cwd");

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
          sessionCount: before.sessions.length,
          error: before.error,
        });
        const workspaceLabel = request.agentName?.trim() || `${agentKind} session`;
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
          sessionCount: after.sessions.length,
          error: after.error,
        });
        const beforeIds = new Set(before.sessions.map((session) => session.nativeId));
        const candidate = after.sessions.find(
          (session) =>
            !beforeIds.has(session.nativeId) &&
            (session.nativeId === paneId ||
              session.displayName === name ||
              session.worktree === workingDirectory),
        );
        return {
          ok: true,
          nativeId: candidate?.nativeId,
          message: candidate
            ? `Started ${agentKind} in Herdr${promptWarning ? ` · warning: ${promptWarning}` : ""}.`
            : `Started ${agentKind} in Herdr; waiting for the new session to appear${promptWarning ? ` · warning: ${promptWarning}` : ""}.`,
        };
      },
      catch: (error) =>
        hostError("host.launch", error instanceof Error ? error.message : String(error)),
    });
  }

  private async snapshotInternal(): Promise<HostSnapshot> {
    this.liveTargets.clear();
    let result;
    try {
      result = await this.runner.run(["herdr", "api", "snapshot"]);
    } catch (error) {
      return {
        hostKind: "herdr",
        available: false,
        observedAt: this.clock.now(),
        sessions: [],
        diagnostics: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (result.exitCode !== 0) {
      return {
        hostKind: "herdr",
        available: false,
        observedAt: this.clock.now(),
        sessions: [],
        diagnostics: [],
        error: commandFailureMessage(result, `Herdr exited with ${result.exitCode}.`),
      };
    }
    const snapshot = parseHerdrSnapshot(parseJsonValue(result.stdout), this.clock.now());
    this.liveTargets.clear();
    const nativeIds = new Set<string>();
    const ambiguous = snapshot.sessions.some((session) => {
      if (nativeIds.has(session.nativeId)) return true;
      nativeIds.add(session.nativeId);
      return false;
    });
    if (!ambiguous)
      for (const session of snapshot.sessions)
        this.liveTargets.set(session.nativeId, {
          kind: "herdr-agent-attach",
          token: session.nativeId,
        });
    return snapshot;
  }

  access(session: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Effect.Effect<SessionAccess, HostError> {
    return Effect.sync(() => {
      if (session.hostKind !== "herdr")
        return {
          supported: false,
          capabilities: [],
          explanation: "This session belongs to an unsupported host.",
        } satisfies SessionAccess;
      const target = this.liveTargets.get(session.nativeId);
      if (!target)
        return {
          supported: false,
          capabilities: [],
          explanation: "The session is not present in the latest Herdr snapshot.",
        } satisfies SessionAccess;
      return {
        supported: true,
        capabilities: ["embedded-terminal", "native-handoff"],
        mode: "attach",
        target,
        terminalTarget: {
          kind: "herdr-terminal-control",
          token: session.nativeId,
        },
        explanation: "Attach directly or open an embedded terminal for the running Herdr session.",
      } satisfies SessionAccess;
    });
  }

  activate(access: SessionAccess): Effect.Effect<HostActionResult, HostError> {
    return Effect.tryPromise({
      try: async () => {
        if (!access.supported || !access.target) return { ok: false, message: access.explanation };
        const token = parseTarget(access.target);
        if (!token)
          return {
            ok: false,
            message: "The Herdr attachment target is invalid or unsupported.",
          };
        const result = await this.runner.run(["herdr", "agent", "attach", token], {
          interactive: true,
        });
        if (result.exitCode !== 0)
          return {
            ok: false,
            message: result.stderr.trim() || `Herdr could not attach to ${token}.`,
          };
        return { ok: true, message: `Attached to the real Herdr session ${token}.` };
      },
      catch: () => hostError("host.activate", "Herdr could not attach to the session."),
    });
  }

  openTerminal(
    access: SessionAccess,
    dimensions: TerminalDimensions,
  ): Effect.Effect<HostTerminalOpenResult, HostError> {
    return Effect.sync(() => {
      if (!access.supported || !access.terminalTarget)
        return {
          ok: false,
          message: "This session does not expose an embedded Herdr terminal.",
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
      try {
        return {
          ok: true,
          terminal: openHerdrTerminal(this.terminalRunner, token, dimensions),
          message: `Opened an embedded Herdr terminal for ${token}.`,
        } satisfies HostTerminalOpenResult;
      } catch (error) {
        return {
          ok: false,
          message: `Could not open the Herdr terminal: ${error instanceof Error ? error.message : String(error)}`,
        } satisfies HostTerminalOpenResult;
      }
    });
  }
}
