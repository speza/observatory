import { Effect, Schema } from "effect";
import type {
  CommandCentreProjection,
  CatchUpProjection,
  CloseoutProjection,
  InspectorProjection,
  Projection,
  SearchProjection,
  UniverseMapProjection,
} from "../projection/types.ts";
import type { SessionHost } from "../hosts/types.ts";
import type { Universe } from "../universe/universe.ts";
import type { Clock } from "../universe/types.ts";
import type { WorkspaceDiffReader, WorkspaceProvider } from "../workspaces/types.ts";
import type { StartAgentCoordinator } from "../session-launch/types.ts";
import type { AgentRepositoryStatusReader } from "../repositories/types.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import type { ConversationTrackerModule } from "../conversations/types.ts";
import { WebCommandError, WebCommandGateway } from "./commands.ts";
import { WebLaunchError, WebLaunchGateway } from "./launch.ts";
import type {
  WebCommandResponse,
  WebCloseoutResponse,
  WebLaunchOptionsResponse,
  WebPendingLaunchesResponse,
  WebStartAgentResponse,
  WebWorkspaceBrowserResponse,
  WebTerminalLinksResponse,
  WebWorkingTreeDiffResponse,
  WebTerminalActionResponse,
  WebTerminalOpenResponse,
  WebAgentRepositoryStatusResponse,
  WebPluginStatusResponse,
  WebConversationHistoryResponse,
  WebAddConversationResponse,
} from "./protocol.ts";
import { WebTerminalError, WebTerminalGateway } from "./terminal.ts";
import { createAgentCloseoutCoordinator } from "../agent-closeout/coordinator.ts";
import { WebCloseoutError, WebCloseoutGateway } from "./closeout.ts";
import type { AgentObservationModule } from "../agent-observations/types.ts";
import {
  enrichCatchUp,
  enrichCommandCentre,
  enrichInspector,
  enrichMap,
} from "../agent-observations/projection.ts";

export interface PortfolioResponse {
  readonly map: UniverseMapProjection;
  readonly commandCentre: CommandCentreProjection;
  readonly catchUp: CatchUpProjection;
  readonly closeout: CloseoutProjection;
}

interface ErrorResponse {
  readonly error: string;
}

const MAXIMUM_SEARCH_QUERY_LENGTH = 200;
const MAXIMUM_SEARCH_RESULTS = 50;

const AddConversationRequestSchema = Schema.Struct({
  handle: Schema.String,
  goalId: Schema.optional(Schema.String),
});
const CommandTypeSchema = Schema.Struct({ type: Schema.String });

type WebResponse =
  | PortfolioResponse
  | Projection
  | WebCommandResponse
  | WebLaunchOptionsResponse
  | WebPendingLaunchesResponse
  | WebStartAgentResponse
  | WebWorkspaceBrowserResponse
  | WebWorkingTreeDiffResponse
  | WebTerminalOpenResponse
  | WebTerminalLinksResponse
  | WebTerminalActionResponse
  | WebCloseoutResponse
  | WebAgentRepositoryStatusResponse
  | WebPluginStatusResponse
  | WebConversationHistoryResponse
  | WebAddConversationResponse
  | ErrorResponse;

const json = (body: WebResponse, status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const targetType = (value: string | null): "goal" | "agent" | undefined => {
  if (value === "goal" || value === "agent") return value;
  return undefined;
};

export class ObservatoryWebApi {
  private readonly commands: WebCommandGateway;
  private readonly terminals: WebTerminalGateway | undefined;
  private readonly launch: WebLaunchGateway | undefined;
  private readonly closeout: WebCloseoutGateway | undefined;

  constructor(
    private readonly universe: Universe,
    private readonly clock: Clock,
    private readonly allowedOrigin = "http://127.0.0.1:4310",
    host?: SessionHost,
    private readonly diffReader?: WorkspaceDiffReader,
    launch?: {
      readonly coordinator: StartAgentCoordinator;
      readonly workspace: WorkspaceProvider;
    },
    private readonly repositoryStatus?: AgentRepositoryStatusReader,
    private readonly plugins?: PluginRegistry,
    private readonly conversations?: ConversationTrackerModule,
    private readonly agentObservations?: AgentObservationModule,
  ) {
    this.commands = new WebCommandGateway(universe);
    this.terminals = host ? new WebTerminalGateway(universe, host, launch?.coordinator) : undefined;
    this.closeout =
      host && conversations
        ? new WebCloseoutGateway(
            createAgentCloseoutCoordinator({
              universe,
              host,
              observeHost: conversations.observeHost.bind(conversations),
            }),
          )
        : undefined;
    this.launch =
      host && launch && plugins
        ? new WebLaunchGateway(universe, plugins, launch.workspace, launch.coordinator)
        : undefined;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = this.clock.now();

    if (url.pathname.startsWith("/api/terminal/")) return this.terminal(request, url);

    if (url.pathname.startsWith("/api/launch/")) return this.agentLaunch(request, url);

    if (url.pathname.startsWith("/api/conversations/"))
      return this.conversationHistory(request, url);

    if (url.pathname === "/api/closeout/close") {
      if (!this.closeout) return json({ error: "Agent closeout is unavailable." }, 501);
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const rejected = this.rejectMutation(request);
      if (rejected) return rejected;
      try {
        const result = await this.closeout.closeAndArchive(await request.text());
        const portfolio = this.portfolio(this.clock.now());
        if (portfolio instanceof Response) return portfolio;
        return json({ result, portfolio } satisfies WebCloseoutResponse);
      } catch (error) {
        if (error instanceof WebCloseoutError) return json({ error: error.message }, error.status);
        return json({ error: "Agent closeout failed unexpectedly." }, 500);
      }
    }

    if (url.pathname === "/api/commands") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (
        request.headers.get("origin") !== this.allowedOrigin ||
        request.headers.get("x-ao-command") !== "1"
      )
        return json({ error: "Command origin rejected." }, 403);
      if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
        return json({ error: "Commands require application/json." }, 415);
      try {
        const body = await request.text();
        const result = this.commands.execute(body);
        if (!result.ok) return json({ error: result.error ?? "Command rejected." }, 409);
        if (
          Schema.decodeUnknownSync(Schema.parseJson(CommandTypeSchema))(body).type ===
          "AcknowledgeCatchUp"
        )
          this.agentObservations?.acknowledge(this.clock.now());
        const portfolio = this.portfolio(this.clock.now());
        if (portfolio instanceof Response) return portfolio;
        return json({ result, portfolio } satisfies WebCommandResponse);
      } catch (error) {
        if (error instanceof WebCommandError) return json({ error: error.message }, error.status);
        return json({ error: "Command could not be read." }, 400);
      }
    }

    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);

    if (url.pathname === "/api/portfolio") {
      const portfolio = this.portfolio(now);
      return portfolio instanceof Response ? portfolio : json(portfolio);
    }

    if (url.pathname === "/api/inspector") {
      const type = targetType(url.searchParams.get("type"));
      const id = url.searchParams.get("id")?.trim();
      if (!type || !id) return json({ error: "A valid target type and id are required." }, 400);
      const baseProjection = this.universe.project({
        kind: "inspector",
        now,
        target: { type, id },
      });
      const projection =
        this.agentObservations &&
        (baseProjection.kind === "goal-inspector" ||
          baseProjection.kind === "agent-inspector" ||
          baseProjection.kind === "empty-inspector")
          ? enrichInspector(
              baseProjection satisfies InspectorProjection,
              this.agentObservations.snapshot(),
            )
          : baseProjection;
      return json(projection);
    }

    if (url.pathname === "/api/search") {
      const query = url.searchParams.get("q")?.trim();
      if (!query) return json({ error: "A search query is required." }, 400);
      if (query.length > MAXIMUM_SEARCH_QUERY_LENGTH)
        return json({ error: "The search query is too long." }, 400);
      const projection = this.universe.project({ kind: "search", now, query });
      if (projection.kind !== "search")
        return json({ error: "Projection contract mismatch." }, 500);
      return json({
        ...projection,
        results: projection.results.slice(0, MAXIMUM_SEARCH_RESULTS),
      } satisfies SearchProjection);
    }

    if (url.pathname === "/api/plugins") {
      if (!this.plugins) return json({ error: "Plugin diagnostics are unavailable." }, 501);
      return json({ kind: "plugin-status", plugins: this.plugins.status() });
    }

    if (url.pathname === "/api/repository") {
      const agentId = url.searchParams.get("agentId")?.trim();
      if (!agentId) return json({ error: "An agent id is required." }, 400);
      if (!this.repositoryStatus)
        return json({ error: "Repository status inspection is unavailable." }, 501);
      const freshness = url.searchParams.get("refresh") === "1" ? "refresh" : "cached";
      try {
        return json(await Effect.runPromise(this.repositoryStatus.inspect(agentId, { freshness })));
      } catch (error) {
        const status =
          error instanceof Error && "kind" in error && error.kind === "agent-not-found" ? 404 : 503;
        return json(
          { error: error instanceof Error ? error.message : "Repository inspection failed." },
          status,
        );
      }
    }

    if (url.pathname === "/api/diff") {
      const agentId = url.searchParams.get("agentId")?.trim();
      if (!agentId) return json({ error: "An agent id is required." }, 400);
      const snapshot = this.universe.snapshot();
      const agent = snapshot.agents.find((candidate) => candidate.id === agentId);
      if (!agent) return json({ error: "Agent not found." }, 404);
      if (!this.diffReader)
        return json({ error: "Workspace diff inspection is unavailable." }, 501);
      if (!agent.worktree) {
        return json({
          kind: "working-tree-diff",
          agentId: agent.id,
          agentName: agent.displayName,
          goalTitle: snapshot.goals.find((goal) => goal.id === agent.primaryGoalId)?.title,
          status: "unavailable",
          worktree: "",
          repository: agent.repository,
          branch: agent.branch,
          files: [],
          additions: 0,
          deletions: 0,
          truncated: false,
          generatedAt: now,
          message: "This agent has not reported a workspace path.",
        } satisfies WebWorkingTreeDiffResponse);
      }
      try {
        const diff = await Effect.runPromise(
          this.diffReader.inspectWorkingTree(agent.worktree, now),
        );
        return json({
          ...diff,
          agentId: agent.id,
          agentName: agent.displayName,
          goalTitle: snapshot.goals.find((goal) => goal.id === agent.primaryGoalId)?.title,
          repository: agent.repository ?? diff.repository,
          branch: agent.branch ?? diff.branch,
        } satisfies WebWorkingTreeDiffResponse);
      } catch {
        return json({ error: "Workspace diff inspection failed." }, 503);
      }
    }

    return json({ error: "Not found." }, 404);
  }

  async close(): Promise<void> {
    await this.terminals?.closeAll();
    if (this.plugins) await Effect.runPromise(this.plugins.close());
  }

  private portfolio(now: number): PortfolioResponse | Response {
    const map = this.universe.project({ kind: "universe-map", now });
    const commandCentre = this.universe.project({ kind: "command-centre", now });
    const catchUp = this.universe.project({ kind: "catch-up", now });
    const closeout = this.universe.project({ kind: "closeout", now });
    if (
      map.kind !== "universe-map" ||
      commandCentre.kind !== "command-centre" ||
      catchUp.kind !== "catch-up" ||
      closeout.kind !== "closeout"
    )
      return json({ error: "Projection contract mismatch." }, 500);
    if (!this.agentObservations) return { map, commandCentre, catchUp, closeout };
    const evidence = this.agentObservations.snapshot();
    return {
      map: enrichMap(map, evidence),
      commandCentre: enrichCommandCentre(commandCentre, evidence),
      catchUp: enrichCatchUp(catchUp, evidence),
      closeout,
    };
  }

  private async terminal(request: Request, url: URL): Promise<Response> {
    if (!this.terminals) return json({ error: "Terminal transport is unavailable." }, 501);
    if (url.pathname === "/api/terminal/links") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      const agentId = url.searchParams.get("agentId")?.trim();
      if (!agentId) return json({ error: "An agent id is required." }, 400);
      try {
        return json(await this.terminals.linkedExecutions(agentId));
      } catch (error) {
        return error instanceof WebTerminalError
          ? this.terminalError(error)
          : json({ error: "Terminal transport failed." }, 500);
      }
    }
    const match = /^\/api\/terminal\/([^/]+)\/(events|input|resize|release)$/u.exec(url.pathname);
    if (url.pathname === "/api/terminal/open") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const rejected = this.rejectMutation(request);
      if (rejected) return rejected;
      try {
        return json(await this.terminals.open(await request.text()));
      } catch (error) {
        return error instanceof WebTerminalError
          ? this.terminalError(error)
          : json({ error: "Terminal transport failed." }, 500);
      }
    }
    if (!match) return json({ error: "Not found." }, 404);
    const [, sessionId, action] = match;
    if (!sessionId || !action) return json({ error: "Not found." }, 404);
    if (action === "events") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      try {
        return this.terminals.events(sessionId);
      } catch (error) {
        return error instanceof WebTerminalError
          ? this.terminalError(error)
          : json({ error: "Terminal transport failed." }, 500);
      }
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    const rejected = this.rejectMutation(request);
    if (rejected) return rejected;
    try {
      if (action === "input")
        return json(await this.terminals.input(sessionId, await request.text()));
      if (action === "resize")
        return json(await this.terminals.resize(sessionId, await request.text()));
      return json(await this.terminals.release(sessionId));
    } catch (error) {
      return error instanceof WebTerminalError
        ? this.terminalError(error)
        : json({ error: "Terminal transport failed." }, 500);
    }
  }

  private async agentLaunch(request: Request, url: URL): Promise<Response> {
    if (!this.launch) return json({ error: "Agent launch is unavailable." }, 501);
    try {
      if (url.pathname === "/api/launch/options") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
        return json(await this.launch.options());
      }
      if (url.pathname === "/api/launch/browse") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
        const path = url.searchParams.get("path")?.trim();
        if (!path) return json({ error: "A workspace path is required." }, 400);
        return json(await this.launch.browse(path));
      }
      if (url.pathname === "/api/launch/pending") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
        return json(await this.launch.pending(url.searchParams.get("refresh") === "1"));
      }
      if (url.pathname === "/api/launch/start") {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
        const rejected = this.rejectMutation(request);
        if (rejected) return rejected;
        const result = await this.launch.start(await request.text());
        const portfolio = this.portfolio(this.clock.now());
        if (portfolio instanceof Response) return portfolio;
        return json({
          result,
          portfolio,
          pendingLaunch: this.launch.pendingLaunch(result.requestId),
        } satisfies WebStartAgentResponse);
      }
      if (url.pathname === "/api/launch/resume") {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
        const rejected = this.rejectMutation(request);
        if (rejected) return rejected;
        const result = await this.launch.resume(await request.text());
        const portfolio = this.portfolio(this.clock.now());
        if (portfolio instanceof Response) return portfolio;
        return json({ result, portfolio } satisfies WebStartAgentResponse);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return error instanceof WebLaunchError
        ? json({ error: error.message }, error.status)
        : json({ error: "Agent launch failed." }, 500);
    }
  }

  private rejectMutation(request: Request): Response | undefined {
    if (
      request.headers.get("origin") !== this.allowedOrigin ||
      request.headers.get("x-ao-command") !== "1"
    )
      return json({ error: "Command origin rejected." }, 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return json({ error: "Commands require application/json." }, 415);
    return undefined;
  }

  private async conversationHistory(request: Request, url: URL): Promise<Response> {
    if (!this.conversations) return json({ error: "Conversation history is unavailable." }, 501);
    if (url.pathname === "/api/conversations/history") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      if (url.searchParams.get("refresh") === "1")
        await Effect.runPromise(this.conversations.refresh());
      return json({
        kind: "conversation-history",
        conversations: this.conversations.history(),
      } satisfies WebConversationHistoryResponse);
    }
    if (url.pathname === "/api/conversations/add") {
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const rejected = this.rejectMutation(request);
      if (rejected) return rejected;
      try {
        const values = Schema.decodeUnknownSync(Schema.parseJson(AddConversationRequestSchema))(
          await request.text(),
        );
        if (!values.handle.trim())
          return json({ error: "A conversation handle is required." }, 400);
        const goalId = values.goalId?.trim() || undefined;
        const added = this.conversations.add(values.handle, goalId);
        const portfolio = this.portfolio(this.clock.now());
        if (portfolio instanceof Response) return portfolio;
        return json({ ...added, portfolio } satisfies WebAddConversationResponse);
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : "Conversation could not be added.",
          },
          409,
        );
      }
    }
    return json({ error: "Not found." }, 404);
  }

  private terminalError(error: WebTerminalError): Response {
    return json({ error: error.message }, error.status);
  }
}
