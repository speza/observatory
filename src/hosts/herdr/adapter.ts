import type { Clock } from "../../universe/types.ts";
import type {
  HostActionResult,
  HostSessionObservation,
  HostSnapshot,
  OpaqueAccessTarget,
  SessionAccess,
  SessionHost,
} from "../types.ts";
import { BunCommandRunner, type CommandRunner } from "./runner.ts";

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (record: RecordValue, key: string): string | undefined =>
  typeof record[key] === "string" && record[key] ? record[key] : undefined;
const status = (value: unknown): HostSessionObservation["runtimeState"] => {
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

const nonEmptyRecord = (value: unknown): RecordValue => (isRecord(value) ? value : {});

const unwrapSnapshot = (value: unknown): RecordValue | undefined => {
  if (!isRecord(value)) return undefined;
  const result = nonEmptyRecord(value.result);
  const snapshot = result.snapshot;
  if (isRecord(snapshot)) return snapshot;
  if (isRecord(value.snapshot)) return value.snapshot;
  return undefined;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const locator = (workspaceId: string, tabId: string, paneId: string, terminalId: string): string =>
  JSON.stringify({ workspaceId, tabId, paneId, terminalId });

export const parseHerdrSnapshot = (payload: unknown, observedAt: number): HostSnapshot => {
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
  const panes = Array.isArray(snapshot.panes) ? snapshot.panes : [];
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
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
    const displayName =
      stringValue(item, "name") ??
      stringValue(item, "title") ??
      stringValue(item, "terminal_title_stripped") ??
      stringValue(pane, "terminal_title_stripped") ??
      stringValue(item, "label") ??
      stringValue(workspace, "label") ??
      paneId;
    const repository = stringValue(worktree, "repo_name");
    const worktreePath = stringValue(worktree, "checkout_path");
    const provider = stringValue(item, "display_agent") ?? stringValue(item, "agent");
    const observedState = status(item.agent_status ?? pane.agent_status);
    sessions.push({
      nativeId: paneId,
      displayName,
      runtimeState: observedState,
      runtimeStateSource: "herdr.agent_status",
      observedAt,
      ...(repository ? { repository } : {}),
      ...(stringValue(worktree, "branch") ? { branch: stringValue(worktree, "branch") } : {}),
      ...(worktreePath ? { worktree: worktreePath } : {}),
      ...(provider ? { provider } : {}),
      hostLocator: locator(workspaceId, tabId, paneId, terminalId),
    });
  }
  if (!Array.isArray(snapshot.panes)) diagnostics.push("Herdr snapshot omitted its panes array.");
  if (!Array.isArray(snapshot.agents)) diagnostics.push("Herdr snapshot omitted its agents array.");
  return {
    hostKind: "herdr",
    available: true,
    observedAt,
    sessions,
    diagnostics,
  };
};

const parseTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "herdr-agent-focus" ? target.token : undefined;

export class HerdrHostAdapter implements SessionHost {
  private readonly runner: CommandRunner;
  private readonly clock: Clock;
  private readonly liveTargets = new Map<string, OpaqueAccessTarget>();

  constructor(options: { readonly runner?: CommandRunner; readonly clock: Clock }) {
    this.runner = options.runner ?? new BunCommandRunner();
    this.clock = options.clock;
  }

  async snapshot(): Promise<HostSnapshot> {
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
        error: result.stderr.trim() || `Herdr exited with ${result.exitCode}.`,
      };
    }
    const snapshot = parseHerdrSnapshot(parseJson(result.stdout), this.clock.now());
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
          kind: "herdr-agent-focus",
          token: session.nativeId,
        });
    return snapshot;
  }

  async access(session: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Promise<SessionAccess> {
    if (session.hostKind !== "herdr")
      return {
        supported: false,
        explanation: "This session belongs to an unsupported host.",
      };
    const target = this.liveTargets.get(session.nativeId);
    if (!target)
      return {
        supported: false,
        explanation: "The session is not present in the latest Herdr snapshot.",
      };
    return {
      supported: true,
      mode: "focus",
      target,
      explanation: "Focus this pane in the running Herdr session.",
    };
  }

  async activate(access: SessionAccess): Promise<HostActionResult> {
    if (!access.supported || !access.target) return { ok: false, message: access.explanation };
    const token = parseTarget(access.target);
    if (!token)
      return {
        ok: false,
        message: "The Herdr attachment target is invalid or unsupported.",
      };
    const result = await this.runner.run(["herdr", "agent", "focus", token]);
    if (result.exitCode !== 0)
      return {
        ok: false,
        message: result.stderr.trim() || `Herdr could not focus ${token}.`,
      };
    return { ok: true, message: `Focused the real Herdr session ${token}.` };
  }
}
