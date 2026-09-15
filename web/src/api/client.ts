import type { InspectorProjection, SearchProjection } from "../../../src/projection/types.ts";
import { Schema } from "effect";
import {
  AgentRepositoryStatusResponseSchema,
  AddConversationResponseSchema,
  AdmitDiscoveredExecutionResponseSchema,
  BrowserProjectionEventSchema,
  CloseoutResponseSchema,
  CommandResponseSchema,
  ConversationHistoryResponseSchema,
  InspectorProjectionSchema,
  LaunchOptionsResponseSchema,
  SearchProjectionSchema,
  StartAgentResponseSchema,
  TerminalOpenResponseSchema,
  WebPortfolioResponseSchema,
  WebTerminalActionResponseSchema,
  WebTerminalLinksResponseSchema,
  WebTerminalServerMessageSchema,
  WorkspaceBrowserResponseSchema,
  WorkspaceReviewFileResponseSchema,
  WorkspaceReviewResponseSchema,
  type BrowserProjectionEvent,
  type WebCommand,
  type WebCommandResponse,
  type WebCloseoutResponse,
  type WebLaunchOptionsResponse,
  type WebPortfolioResponse,
  type WebResumeAgentRequest,
  type WebResumeAgentResponse,
  type WebStartAgentRequest,
  type WebStartAgentResponse,
  type WebTerminalActionResponse,
  type WebTerminalLinksResponse,
  type WebTerminalOpenResponse,
  type WebTerminalServerMessage,
  type WebAgentRepositoryStatusResponse,
  type WebConversationHistoryResponse,
  type WebAddConversationResponse,
  type WebAdmitDiscoveredExecutionResponse,
  type WebWorkspaceBrowserResponse,
  type WebWorkspaceReviewFileResponse,
  type WebWorkspaceReviewResponse,
} from "../../../src/web/protocol/index.ts";

const responseFor = async (path: string, signal?: AbortSignal): Promise<Response> => {
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Observatory request failed (${response.status}).`);
  return response;
};

export const projectionEventsUrl = (): string => "/api/projections/events";

export const decodeBrowserProjectionEvent = (value: string): BrowserProjectionEvent =>
  Schema.decodeUnknownSync(Schema.parseJson(BrowserProjectionEventSchema))(value);

export const fetchPortfolio = async (signal?: AbortSignal): Promise<WebPortfolioResponse> => {
  const response = await responseFor("/api/portfolio", signal);
  return Schema.decodeUnknownSync(WebPortfolioResponseSchema)(await response.json());
};

export const fetchConversationHistory = async (options?: {
  readonly refresh?: boolean;
  readonly signal?: AbortSignal;
}): Promise<WebConversationHistoryResponse> => {
  const response = await responseFor(
    `/api/conversations/history${options?.refresh ? "?refresh=1" : ""}`,
    options?.signal,
  );
  return Schema.decodeUnknownSync(ConversationHistoryResponseSchema)(await response.json());
};

export const addConversation = async (
  handle: string,
  goalId?: string,
  systemId?: string,
): Promise<WebAddConversationResponse> => {
  const response = await fetch("/api/conversations/add", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ao-command": "1" },
    body: JSON.stringify({ handle, goalId, systemId }),
  });
  if (!response.ok)
    throw new Error(await errorMessage(response, `Add conversation failed (${response.status}).`));
  return Schema.decodeUnknownSync(AddConversationResponseSchema)(await response.json());
};

export const admitDiscoveredExecution = async (
  handle: string,
  goalId?: string,
  systemId?: string,
): Promise<WebAdmitDiscoveredExecutionResponse> => {
  const response = await fetch("/api/discoveries/admit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-ao-command": "1" },
    body: JSON.stringify({ handle, goalId, systemId }),
  });
  if (!response.ok)
    throw new Error(
      await errorMessage(response, `Discovered execution admission failed (${response.status}).`),
    );
  return Schema.decodeUnknownSync(AdmitDiscoveredExecutionResponseSchema)(await response.json());
};

export const fetchInspector = async (
  type: "goal" | "agent" | "discovered-execution",
  id: string,
  signal?: AbortSignal,
): Promise<InspectorProjection> => {
  const response = await responseFor(
    `/api/inspector?type=${type}&id=${encodeURIComponent(id)}`,
    signal,
  );
  return Schema.decodeUnknownSync(InspectorProjectionSchema)(await response.json());
};

export const fetchSearch = async (
  query: string,
  signal?: AbortSignal,
): Promise<SearchProjection> => {
  const response = await responseFor(`/api/search?q=${encodeURIComponent(query)}`, signal);
  return Schema.decodeUnknownSync(SearchProjectionSchema)(await response.json());
};

export const fetchWorkspaceReview = async (
  agentId: string,
  signal?: AbortSignal,
): Promise<WebWorkspaceReviewResponse> => {
  const response = await responseFor(`/api/review?agentId=${encodeURIComponent(agentId)}`, signal);
  const body = Schema.decodeUnknownSync(WorkspaceReviewResponseSchema)(await response.json());
  if (body.agentId !== agentId)
    throw new Error("Observatory returned an invalid workspace review.");
  return body;
};

export const fetchWorkspaceReviewFile = async (
  agentId: string,
  snapshotId: string,
  fileId: string,
  view: "source" | "baseline",
  signal?: AbortSignal,
): Promise<WebWorkspaceReviewFileResponse> => {
  const query = new URLSearchParams({ agentId, snapshotId, fileId, view });
  const response = await responseFor(`/api/review/file?${query.toString()}`, signal);
  const body = Schema.decodeUnknownSync(WorkspaceReviewFileResponseSchema)(await response.json());
  if (body.snapshotId !== snapshotId || body.fileId !== fileId || body.view !== view)
    throw new Error("Observatory returned an invalid workspace file.");
  return body;
};

export const fetchAgentRepositoryStatus = async (
  agentId: string,
  options?: { readonly refresh?: boolean; readonly signal?: AbortSignal },
): Promise<WebAgentRepositoryStatusResponse> => {
  const response = await responseFor(
    `/api/repository?agentId=${encodeURIComponent(agentId)}${options?.refresh ? "&refresh=1" : ""}`,
    options?.signal,
  );
  const body = Schema.decodeUnknownSync(AgentRepositoryStatusResponseSchema)(await response.json());
  if (body.agentId !== agentId) throw new Error("Observatory returned invalid repository status.");
  return body;
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
  const decoded = Schema.decodeUnknownSync(CommandResponseSchema)(body);
  if (!decoded.result.ok) throw new Error("Observatory returned an invalid command response.");
  return decoded;
};

export const closeAndArchiveAgents = async (
  agentIds: readonly string[],
): Promise<WebCloseoutResponse> => {
  const response = await fetch("/api/closeout/close", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ao-command": "1",
    },
    body: JSON.stringify({ agentIds }),
  });
  if (!response.ok)
    throw new Error(await errorMessage(response, `Agent closeout failed (${response.status}).`));
  return Schema.decodeUnknownSync(CloseoutResponseSchema)(await response.json());
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
  return Schema.decodeUnknownSync(LaunchOptionsResponseSchema)(await response.json());
};

export const browseLaunchWorkspace = async (
  path: string,
  signal?: AbortSignal,
): Promise<WebWorkspaceBrowserResponse> => {
  const response = await responseFor(`/api/launch/browse?path=${encodeURIComponent(path)}`, signal);
  return Schema.decodeUnknownSync(WorkspaceBrowserResponseSchema)(await response.json());
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
  return Schema.decodeUnknownSync(StartAgentResponseSchema)(await response.json());
};

export const resumeWebAgent = async (
  request: WebResumeAgentRequest,
): Promise<WebResumeAgentResponse> => {
  const response = await fetch("/api/launch/resume", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ao-command": "1",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok)
    throw new Error(await errorMessage(response, `Agent resume failed (${response.status}).`));
  return Schema.decodeUnknownSync(StartAgentResponseSchema)(await response.json());
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
  target:
    | { readonly agentId: string }
    | { readonly requestId: string }
    | { readonly discoveryHandle: string },
  dimensions: { readonly columns: number; readonly rows: number },
  options?: {
    readonly linkId?: string;
    readonly resizeMode?: "fit" | "preserve";
  },
): Promise<WebTerminalOpenResponse> => {
  const response = await terminalMutation(
    "/api/terminal/open",
    JSON.stringify({ ...target, dimensions, ...options }),
  );
  return Schema.decodeUnknownSync(TerminalOpenResponseSchema)(await response.json());
};

export const fetchTerminalLinks = async (
  agentId: string,
  signal?: AbortSignal,
): Promise<WebTerminalLinksResponse> => {
  const response = await responseFor(
    `/api/terminal/links?agentId=${encodeURIComponent(agentId)}`,
    signal,
  );
  return Schema.decodeUnknownSync(WebTerminalLinksResponseSchema)(await response.json());
};

export const releaseWebTerminal = async (sessionId: string): Promise<WebTerminalActionResponse> => {
  const response = await terminalMutation(
    `/api/terminal/${encodeURIComponent(sessionId)}/release`,
    "{}",
  );
  return Schema.decodeUnknownSync(WebTerminalActionResponseSchema)(await response.json());
};

export const webTerminalSocketUrl = (sessionId: string, afterDeliveryId?: number): string => {
  const url = new URL(
    `/api/terminal/${encodeURIComponent(sessionId)}/socket`,
    window.location.href,
  );
  if (afterDeliveryId !== undefined) url.searchParams.set("after", String(afterDeliveryId));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

export const parseWebTerminalMessage = (text: string): WebTerminalServerMessage =>
  Schema.decodeUnknownSync(Schema.parseJson(WebTerminalServerMessageSchema))(text);
