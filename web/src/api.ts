import type { InspectorProjection } from "../../src/projection/types.ts";
import type { PortfolioResponse } from "../../src/web/api.ts";
import type {
  WebCommand,
  WebCommandResponse,
  WebLaunchOptionsResponse,
  WebStartAgentRequest,
  WebStartAgentResponse,
  WebWorkspaceBrowserResponse,
  WebWorkingTreeDiffResponse,
  WebTerminalActionResponse,
  WebTerminalEvent,
  WebTerminalLink,
  WebTerminalLinksResponse,
  WebTerminalOpenResponse,
  WebTerminalScrollRequest,
} from "../../src/web/protocol.ts";
import { Schema } from "effect";

interface ProjectionKindEnvelope {
  readonly kind?: string;
}

interface PortfolioEnvelope {
  readonly map?: ProjectionKindEnvelope;
  readonly commandCentre?: ProjectionKindEnvelope;
  readonly catchUp?: ProjectionKindEnvelope;
}

const TerminalOpenSchema = Schema.Struct({ sessionId: Schema.String, message: Schema.String });
const LaunchGoalSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  priority: Schema.Literal("P0", "P1", "P2", "P3"),
});
const WorkspaceChoiceSchema = Schema.Struct({
  path: Schema.String,
  label: Schema.String,
  kind: Schema.Literal("workspace", "directory"),
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  available: Schema.Boolean,
});
const LaunchOptionSchema = Schema.Struct({
  kind: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
});
const LaunchOptionsSchema: Schema.Schema<WebLaunchOptionsResponse> = Schema.Struct({
  kind: Schema.Literal("launch-options"),
  goals: Schema.Array(LaunchGoalSchema),
  locations: Schema.Array(WorkspaceChoiceSchema),
  agents: Schema.Array(LaunchOptionSchema),
});
const WorkspaceBrowserSchema: Schema.Schema<WebWorkspaceBrowserResponse> = Schema.Struct({
  kind: Schema.Literal("workspace-browser"),
  path: Schema.String,
  parentPath: Schema.optional(Schema.String),
  entries: Schema.Array(WorkspaceChoiceSchema),
});
const TerminalLinkSchema: Schema.Schema<WebTerminalLink> = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("shell", "agent"),
  label: Schema.String,
  source: Schema.Literal("observed", "prepared"),
  available: Schema.Boolean,
  explanation: Schema.String,
});
const TerminalLinksSchema: Schema.Schema<WebTerminalLinksResponse> = Schema.Struct({
  kind: Schema.Literal("terminal-links"),
  agentId: Schema.String,
  agentName: Schema.String,
  links: Schema.Array(TerminalLinkSchema),
  message: Schema.optional(Schema.String),
});
const TerminalActionSchema = Schema.Struct({ ok: Schema.Literal(true), message: Schema.String });
const TerminalEventSchema: Schema.Schema<WebTerminalEvent> = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("frame"),
    bytes: Schema.String,
    columns: Schema.optional(Schema.Number),
    rows: Schema.optional(Schema.Number),
    sequence: Schema.optional(Schema.Number),
    full: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ kind: Schema.Literal("closed"), reason: Schema.optional(Schema.String) }),
);

const responseFor = async (path: string, signal?: AbortSignal): Promise<Response> => {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Observatory request failed (${response.status}).`);
  return response;
};

export const fetchPortfolio = async (signal?: AbortSignal): Promise<PortfolioResponse> => {
  const response = await responseFor("/api/portfolio", signal);
  const body: unknown = await response.json();
  if (Object.prototype.toString.call(body) !== "[object Object]")
    throw new Error("Observatory returned an invalid portfolio envelope.");
  // SAFETY: The JSON value was checked as an object before reading its optional discriminants.
  const envelope = body as PortfolioEnvelope;
  if (
    envelope.map?.kind !== "universe-map" ||
    envelope.commandCentre?.kind !== "command-centre" ||
    envelope.catchUp?.kind !== "catch-up"
  )
    throw new Error("Observatory returned an invalid projection pair.");
  // SAFETY: Both required projection discriminants were validated from the same-origin endpoint.
  return envelope as PortfolioResponse;
};

export const fetchInspector = async (
  type: "goal" | "agent",
  id: string,
  signal?: AbortSignal,
): Promise<InspectorProjection> => {
  const response = await responseFor(
    `/api/inspector?type=${type}&id=${encodeURIComponent(id)}`,
    signal,
  );
  const body: unknown = await response.json();
  if (Object.prototype.toString.call(body) !== "[object Object]")
    throw new Error("Observatory returned an invalid inspector envelope.");
  // SAFETY: The JSON value was checked as an object before reading its optional discriminant.
  const envelope = body as ProjectionKindEnvelope;
  if (
    envelope.kind !== "goal-inspector" &&
    envelope.kind !== "agent-inspector" &&
    envelope.kind !== "empty-inspector"
  )
    throw new Error("Observatory returned an invalid inspector projection.");
  // SAFETY: Every inspector projection discriminant was validated from the same-origin endpoint.
  return envelope as InspectorProjection;
};

export const fetchWorkingTreeDiff = async (
  agentId: string,
  signal?: AbortSignal,
): Promise<WebWorkingTreeDiffResponse> => {
  const response = await responseFor(`/api/diff?agentId=${encodeURIComponent(agentId)}`, signal);
  const body: unknown = await response.json();
  if (Object.prototype.toString.call(body) !== "[object Object]")
    throw new Error("Observatory returned an invalid diff envelope.");
  // SAFETY: The JSON value was checked as an object before reading its optional discriminant.
  const envelope = body as Partial<WebWorkingTreeDiffResponse>;
  if (envelope.kind !== "working-tree-diff" || envelope.agentId !== agentId)
    throw new Error("Observatory returned an invalid workspace diff.");
  // SAFETY: The same-origin endpoint validated the workspace diff discriminant and agent id.
  return envelope as WebWorkingTreeDiffResponse;
};

export const executeCommand = async (command: WebCommand): Promise<WebCommandResponse> => {
  const response = await fetch("/api/commands", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ao-command": "1",
    },
    body: JSON.stringify(command),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    // SAFETY: The error response is inspected only after confirming it is a plain object.
    const errorValue =
      Object.prototype.toString.call(body) === "[object Object]"
        ? (body as { readonly error?: unknown }).error
        : undefined;
    const message = Schema.is(Schema.String)(errorValue)
      ? errorValue
      : `Observatory command failed (${response.status}).`;
    throw new Error(message);
  }
  if (Object.prototype.toString.call(body) !== "[object Object]")
    throw new Error("Observatory returned an invalid command response.");
  // SAFETY: The same-origin JSON response is a plain object; its nested discriminants are checked next.
  const envelope = body as Partial<WebCommandResponse>;
  if (!envelope.result?.ok || envelope.portfolio?.map.kind !== "universe-map")
    throw new Error("Observatory returned an invalid command response.");
  // SAFETY: The successful command result and both required portfolio discriminants were validated.
  return envelope as WebCommandResponse;
};

const errorMessage = async (response: Response, fallback: string): Promise<string> => {
  const payload: unknown = await response.json();
  // SAFETY: The parsed response is checked to be a plain object before reading its optional error.
  const value =
    Object.prototype.toString.call(payload) === "[object Object]"
      ? (payload as { readonly error?: unknown }).error
      : undefined;
  return Schema.is(Schema.String)(value) ? value : fallback;
};

export const fetchLaunchOptions = async (
  signal?: AbortSignal,
): Promise<WebLaunchOptionsResponse> => {
  const response = await responseFor("/api/launch/options", signal);
  return Schema.decodeUnknownSync(LaunchOptionsSchema)(await response.json());
};

export const browseLaunchWorkspace = async (
  path: string,
  signal?: AbortSignal,
): Promise<WebWorkspaceBrowserResponse> => {
  const response = await responseFor(`/api/launch/browse?path=${encodeURIComponent(path)}`, signal);
  return Schema.decodeUnknownSync(WorkspaceBrowserSchema)(await response.json());
};

export const startWebAgent = async (
  request: WebStartAgentRequest,
): Promise<WebStartAgentResponse> => {
  const response = await fetch("/api/launch/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ao-command": "1",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(await errorMessage(response, `Agent launch failed (${response.status}).`));
  const body: unknown = await response.json();
  if (Object.prototype.toString.call(body) !== "[object Object]")
    throw new Error("Observatory returned an invalid launch response.");
  // SAFETY: The JSON response was checked as a plain object before its discriminants are inspected.
  const envelope = body as Partial<WebStartAgentResponse>;
  if (!envelope.result?.requestId || envelope.portfolio?.map.kind !== "universe-map")
    throw new Error("Observatory returned an invalid launch response.");
  // SAFETY: The request id and portfolio projection discriminants were validated above.
  return envelope as WebStartAgentResponse;
};

const terminalMutation = async (path: string, body: string): Promise<Response> => {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ao-command": "1",
    },
    body,
  });
  if (!response.ok) {
    const payload: unknown = await response.json();
    // SAFETY: The same-origin error response is inspected only after confirming a plain object.
    const errorValue =
      Object.prototype.toString.call(payload) === "[object Object]"
        ? (payload as { readonly error?: unknown }).error
        : undefined;
    throw new Error(
      Schema.is(Schema.String)(errorValue)
        ? errorValue
        : `Terminal request failed (${response.status}).`,
    );
  }
  return response;
};

export const openWebTerminal = async (
  agentId: string,
  dimensions: { readonly columns: number; readonly rows: number },
  options?: {
    readonly linkId?: string;
    readonly resizeMode?: "fit" | "preserve";
  },
): Promise<WebTerminalOpenResponse> => {
  const response = await terminalMutation(
    "/api/terminal/open",
    JSON.stringify({ agentId, dimensions, ...options }),
  );
  return Schema.decodeUnknownSync(TerminalOpenSchema)(await response.json());
};

export const fetchTerminalLinks = async (
  agentId: string,
  signal?: AbortSignal,
): Promise<WebTerminalLinksResponse> => {
  const response = await responseFor(
    `/api/terminal/links?agentId=${encodeURIComponent(agentId)}`,
    signal,
  );
  return Schema.decodeUnknownSync(TerminalLinksSchema)(await response.json());
};

export const sendWebTerminalInput = async (
  sessionId: string,
  value: string,
): Promise<WebTerminalActionResponse> => {
  const response = await terminalMutation(
    `/api/terminal/${encodeURIComponent(sessionId)}/input`,
    JSON.stringify({ value }),
  );
  return Schema.decodeUnknownSync(TerminalActionSchema)(await response.json());
};

export const sendWebTerminalScroll = async (
  sessionId: string,
  request: WebTerminalScrollRequest,
): Promise<WebTerminalActionResponse> => {
  const response = await terminalMutation(
    `/api/terminal/${encodeURIComponent(sessionId)}/input`,
    JSON.stringify({ kind: "scroll", ...request }),
  );
  return Schema.decodeUnknownSync(TerminalActionSchema)(await response.json());
};

export const resizeWebTerminal = async (
  sessionId: string,
  dimensions: { readonly columns: number; readonly rows: number },
): Promise<WebTerminalActionResponse> => {
  const response = await terminalMutation(
    `/api/terminal/${encodeURIComponent(sessionId)}/resize`,
    JSON.stringify(dimensions),
  );
  return Schema.decodeUnknownSync(TerminalActionSchema)(await response.json());
};

export const releaseWebTerminal = async (sessionId: string): Promise<WebTerminalActionResponse> => {
  const response = await terminalMutation(
    `/api/terminal/${encodeURIComponent(sessionId)}/release`,
    "{}",
  );
  return Schema.decodeUnknownSync(TerminalActionSchema)(await response.json());
};

export const webTerminalEventsUrl = (sessionId: string): string =>
  `/api/terminal/${encodeURIComponent(sessionId)}/events`;

export const parseWebTerminalEvent = (text: string): WebTerminalEvent =>
  Schema.decodeUnknownSync(Schema.parseJson(TerminalEventSchema))(text);
