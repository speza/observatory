import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MockHostAdapter } from "../hosts/mock/adapter.ts";
import { createStartAgentCoordinator } from "../session-launch/coordinator.ts";
import { loadPluginRegistry } from "../plugins/registry.ts";
import { resolve } from "node:path";
import {
  hostSnapshot,
  makeUniverse,
  admitObservedConversationsAndReconcile,
} from "../universe/test-support.ts";
import type {
  PreparedWorkspace,
  WorkspaceProvider,
  WorkspaceReviewReader,
  WorkspaceSelection,
} from "../workspaces/types.ts";
import type { AgentRepositoryStatusReader } from "../repositories/types.ts";
import type { ConversationTrackerModule } from "../conversations/types.ts";
import type { StartAgentCoordinator } from "../session-launch/types.ts";
import { ObservatoryWebApi, type PortfolioResponse } from "./api.ts";
import type {
  WebCommand,
  WebCommandResponse,
  WebLaunchOptionsResponse,
  WebStartAgentResponse,
  WebTerminalLinksResponse,
  WebTerminalOpenResponse,
  WebTerminalServerMessage,
  WebWorkspaceReviewResponse,
} from "./protocol.ts";

type TerminalTestBody =
  | {
      readonly agentId: string;
      readonly dimensions: { readonly columns: number; readonly rows: number };
      readonly linkId?: string;
      readonly resizeMode?: "fit" | "preserve";
    }
  | {
      readonly requestId: string;
      readonly dimensions: { readonly columns: number; readonly rows: number };
    }
  | { readonly value: string }
  | { readonly bytes: readonly number[] }
  | {
      readonly kind: "scroll";
      readonly direction: "up" | "down";
      readonly lines: number;
      readonly source: "wheel" | "page-key";
    }
  | { readonly columns: number; readonly rows: number }
  | { readonly release?: never };

describe("ObservatoryWebApi", () => {
  test("serves redacted conversation history and adds by opaque browser handle", async () => {
    const fixture = makeUniverse();
    const conversations: ConversationTrackerModule = {
      refresh: () =>
        Effect.succeed({
          observedProviders: 1,
          discoveredConversations: 1,
          diagnostics: [],
        }),
      history: () => [
        {
          handle: "ps_public-handle",
          harnessId: "codex",
          providerLabel: "Codex",
          title: "Historical conversation",
          workspaceRef: "/synthetic/project",
          lastActiveAt: fixture.clock.now(),
          resumeEligibility: "same-site",
          provenance: "provider-index",
          runtimeState: "runtime-unknown",
        },
      ],
      add: (handle) => {
        expect(handle).toBe("ps_public-handle");
        return { agentId: "agent-history" };
      },
      observeHost: (snapshot) => admitObservedConversationsAndReconcile(fixture.universe, snapshot),
    };
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      conversations,
    });

    const listed = await api.fetch(
      new Request("http://localhost/api/conversations/history?refresh=1"),
    );
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).toContain("ps_public-handle");
    expect(listedText).not.toContain("nativeConversationRef");

    const added = await api.fetch(
      new Request("http://localhost/api/conversations/add", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: JSON.stringify({ handle: "ps_public-handle" }),
      }),
    );
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({ agentId: "agent-history" });
  });

  test("lists launch choices and starts an observed agent through the shared coordinator", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    admitObservedConversationsAndReconcile(
      fixture.universe,
      await Effect.runPromise(host.snapshot()),
    );
    const goal = fixture.universe.execute({ type: "CreateGoal", title: "Web launch proof" });
    if (!goal.goalId) throw new Error("Expected a created goal.");
    const workspace: WorkspaceProvider = {
      listChoices: () =>
        Effect.succeed([
          {
            path: "/synthetic/project",
            label: "project",
            kind: "workspace",
            repository: "project",
            branch: "main",
            available: true,
          },
        ]),
      browse: (path) =>
        Effect.succeed({
          path,
          parentPath: "/synthetic",
          entries: [],
        }),
      prepare: (_selection: WorkspaceSelection) =>
        Effect.succeed({
          path: "/synthetic/project",
          repository: "project",
          branch: "main",
          worktree: false,
          warnings: [],
        } satisfies PreparedWorkspace),
    };
    const plugins = await Effect.runPromise(
      loadPluginRegistry({
        packages: [{ path: resolve(import.meta.dir, "../../plugins/agent-harnesses") }],
        runner: {
          run: async () => ({
            exitCode: 0,
            stdout: "test version",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          }),
        },
      }),
    );
    const coordinator = createStartAgentCoordinator({
      universe: fixture.universe,
      host,
      harnesses: plugins,
      workspace,
    });
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      host,
      launch: { coordinator, workspace },
      plugins,
    });

    const optionsResponse = await api.fetch(new Request("http://localhost/api/launch/options"));
    const options: WebLaunchOptionsResponse = await optionsResponse.json();
    expect(optionsResponse.status).toBe(200);
    expect(options.goals[0]?.id).toBe(goal.goalId);
    expect(options.locations[0]?.path).toBe("/synthetic/project");
    expect(options.agents.some((agent) => agent.harnessId === "codex")).toBe(true);

    const browserResponse = await api.fetch(
      new Request("http://localhost/api/launch/browse?path=/synthetic/project"),
    );
    expect(browserResponse.status).toBe(200);
    expect((await browserResponse.json()).path).toBe("/synthetic/project");

    const startedResponse = await api.fetch(
      new Request("http://localhost/api/launch/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: JSON.stringify({
          requestId: "web-launch-test",
          goalId: goal.goalId,
          workspace: { kind: "existing", path: "/synthetic/project" },
          harnessId: "codex",
          agentName: "Web agent",
          prompt: "Prove the web launch path.",
        }),
      }),
    );
    const started: WebStartAgentResponse = await startedResponse.json();
    expect(startedResponse.status).toBe(200);
    expect(started.result.status).toBe("started");
    expect(started.result.agentId).toBeDefined();
    expect(
      fixture.universe.snapshot().agents.find((agent) => agent.id === started.result.agentId)
        ?.primaryGoalId,
    ).toBe(goal.goalId);
    expect(
      started.portfolio.commandCentre.goals
        .find((candidate) => candidate.id === goal.goalId)
        ?.agents.some((agent) => agent.id === started.result.agentId),
    ).toBe(true);
    expect(JSON.stringify(started.portfolio)).not.toContain("mock-conversation-");

    fixture.universe.invalidateRuntimeFacts();
    const resumable = fixture.universe.project({
      kind: "command-centre",
      now: fixture.clock.now(),
    });
    if (resumable.kind !== "command-centre") throw new Error("Expected command centre.");
    expect(resumable.goals[0]?.agents[0]?.canResume).toBe(false);
    expect(resumable.goals[0]?.agents[0]?.lifecycleState).toBe("runtime-unknown");
    const resumedResponse = await api.fetch(
      new Request("http://localhost/api/launch/resume", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: JSON.stringify({
          requestId: "web-resume-test",
          agentId: started.result.agentId,
        }),
      }),
    );
    const resumed: WebStartAgentResponse = await resumedResponse.json();
    expect(resumedResponse.status).toBe(200);
    expect(resumed.result.status).toBe("already-observed");
    expect(resumed.result.agentId).toBe(started.result.agentId);
    expect(JSON.stringify(resumed.portfolio)).not.toContain("mock-conversation-");

    const foreign = await api.fetch(
      new Request("http://localhost/api/launch/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "x-ao-command": "1",
        },
        body: "{}",
      }),
    );
    const malformed = await api.fetch(
      new Request("http://localhost/api/launch/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: "{}",
      }),
    );
    expect(foreign.status).toBe(403);
    expect(malformed.status).toBe(400);
  });

  test("serves the map and command-centre projections from one Universe", async () => {
    const fixture = makeUniverse();
    admitObservedConversationsAndReconcile(
      fixture.universe,
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Atlas",
          runtimeState: "blocked",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const goal = fixture.universe.execute({
      type: "CreateGoal",
      id: "goal-a",
      title: "Understand concurrent work",
      priority: "P0",
    });
    expect(goal.ok).toBe(true);
    const agentId = fixture.universe.snapshot().agents[0]?.id;
    expect(agentId).toBeDefined();
    if (!agentId) throw new Error("Expected reconciled agent.");
    expect(fixture.universe.execute({ type: "AssignAgent", agentId, goalId: "goal-a" }).ok).toBe(
      true,
    );

    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });
    const response = await api.fetch(new Request("http://localhost/api/portfolio"));
    const body: PortfolioResponse = await response.json();

    expect(response.status).toBe(200);
    expect(body.map.goals[0]?.title).toBe("Understand concurrent work");
    expect(body.map.goals[0]?.agents[0]?.displayName).toBe("Atlas");
    expect(body.commandCentre.attention.currentCount).toBe(1);
  });

  test("serves inspector projections and rejects writes outside the command endpoint", async () => {
    const fixture = makeUniverse();
    expect(
      fixture.universe.execute({
        type: "CreateGoal",
        id: "goal-a",
        title: "Understand concurrent work",
        priority: "P0",
      }).ok,
    ).toBe(true);
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });

    const inspector = await api.fetch(
      new Request("http://localhost/api/inspector?type=goal&id=goal-a"),
    );
    const write = await api.fetch(
      new Request("http://localhost/api/portfolio", { method: "POST" }),
    );

    expect(inspector.status).toBe(200);
    expect((await inspector.json()).kind).toBe("goal-inspector");
    expect(write.status).toBe(405);
  });

  test("serves bounded metadata search and validates its query", async () => {
    const fixture = makeUniverse();
    for (let index = 0; index < 55; index += 1) {
      expect(
        fixture.universe.execute({
          type: "CreateGoal",
          id: `goal-${index}`,
          title: `Atlas search target ${index}`,
          priority: "P1",
        }).ok,
      ).toBe(true);
    }
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });

    const found = await api.fetch(new Request("http://localhost/api/search?q=%20atlas%20"));
    const missing = await api.fetch(new Request("http://localhost/api/search?q=%20%20"));
    const tooLong = await api.fetch(
      new Request(`http://localhost/api/search?q=${"a".repeat(201)}`),
    );

    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ kind: "search", query: "atlas" });
    const repeated = await api.fetch(new Request("http://localhost/api/search?q=atlas"));
    expect((await repeated.json()).results).toHaveLength(50);
    expect(missing.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  test("serves bounded review files through issued handles without accepting paths", async () => {
    const fixture = makeUniverse();
    admitObservedConversationsAndReconcile(
      fixture.universe,
      hostSnapshot([
        {
          nativeId: "native-review",
          displayName: "Review agent",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:native-review",
          worktree: "/trusted/worktree",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const agent = fixture.universe.snapshot().agents[0]!;
    const reader: WorkspaceReviewReader = {
      inspectWorkspace: (path, now) =>
        Effect.succeed({
          kind: "workspace-review",
          snapshotId: "review-1",
          generatedAt: now,
          status: "complete",
          repository: "observatory",
          branch: "main",
          head: "abcdef012345",
          tree: [
            {
              id: "file-1",
              name: "main.ts",
              kind: "file",
              changedDescendants: 0,
              change: "modified",
            },
          ],
          treeComplete: true,
          changes: {
            kind: "working-tree-diff",
            status: "changed",
            worktree: path,
            files: [],
            additions: 1,
            deletions: 1,
            truncated: false,
            generatedAt: now,
          },
          diagnostics: [],
        }),
      readWorkspaceReviewFile: (request, now) =>
        Effect.succeed({
          kind: "workspace-review-file",
          snapshotId: request.snapshotId,
          fileId: request.fileId,
          displayPath: "src/main.ts",
          view: request.view,
          status: "available",
          content: "export {};",
          truncated: false,
          generatedAt: now,
        }),
    };
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      workspaceReview: reader,
    });

    const reviewResponse = await api.fetch(
      new Request(
        `http://localhost/api/review?agentId=${encodeURIComponent(agent.id)}&path=/etc/passwd`,
      ),
    );
    const review: WebWorkspaceReviewResponse = await reviewResponse.json();
    const fileResponse = await api.fetch(
      new Request(
        `http://localhost/api/review/file?agentId=${encodeURIComponent(agent.id)}&snapshotId=${review.snapshotId}&fileId=file-1&view=source&path=/etc/passwd`,
      ),
    );
    const file = await fileResponse.json();

    expect(reviewResponse.status).toBe(200);
    expect(review.changes).not.toHaveProperty("worktree");
    expect(fileResponse.status).toBe(200);
    expect(file).toMatchObject({ displayPath: "src/main.ts", content: "export {};" });

    const diffResponse = await api.fetch(
      new Request(
        `http://localhost/api/review/file?agentId=${encodeURIComponent(agent.id)}&snapshotId=${review.snapshotId}&fileId=file-1&view=diff`,
      ),
    );
    expect(diffResponse.status).toBe(400);
  });

  test("serves repository status by trusted agent id without accepting repository inputs", async () => {
    const fixture = makeUniverse();
    admitObservedConversationsAndReconcile(
      fixture.universe,
      hostSnapshot([
        {
          nativeId: "native-repository",
          displayName: "Repository agent",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:native-repository",
          worktree: "/trusted/worktree",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected reconciled agent.");
    const reader: AgentRepositoryStatusReader = {
      inspect: (agentId) =>
        Effect.succeed({
          kind: "agent-repository-status",
          agentId,
          status: "partial",
          observedAt: fixture.clock.now(),
          diagnostics: ["No pull request found for this repository and branch."],
          pullRequests: [],
          providerCached: false,
          plugins: [],
        }),
    };
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      repositoryStatus: reader,
    });

    const response = await api.fetch(
      new Request(
        `http://localhost/api/repository?agentId=${encodeURIComponent(agent.id)}&repository=other/private&path=/etc/passwd`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.agentId).toBe(agent.id);
    expect(body.diagnostics[0]).toContain("No pull request");
  });

  test("requires same-origin JSON with an explicit command header", async () => {
    const fixture = makeUniverse();
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });
    const body = JSON.stringify({ type: "CreateGoal", title: "A goal", priority: "P1" });

    const noOrigin = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", "x-ao-command": "1" },
        body,
      }),
    );
    const foreignOrigin = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "x-ao-command": "1",
        },
        body,
      }),
    );
    const noIntent = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body,
      }),
    );

    expect(noOrigin.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
    expect(noIntent.status).toBe(403);
    expect(fixture.universe.snapshot().goals).toHaveLength(0);
  });

  test("executes the browser command allow-list and returns a refreshed portfolio", async () => {
    const fixture = makeUniverse();
    admitObservedConversationsAndReconcile(
      fixture.universe,
      hostSnapshot([
        {
          nativeId: "native-a",
          displayName: "Atlas",
          runtimeState: "working",
          runtimeStateSource: "test",
          hostLocator: "test:native-a",
          observedAt: fixture.clock.now(),
        },
      ]),
    );
    const agentId = fixture.universe.snapshot().agents[0]?.id;
    if (!agentId) throw new Error("Expected reconciled agent.");
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });
    const command = async (body: WebCommand): Promise<Response> =>
      api.fetch(
        new Request("http://localhost/api/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-ao-command": "1",
          },
          body: JSON.stringify(body),
        }),
      );

    const createdSystem = await command({
      type: "CreateSystem",
      title: "Observatory",
      description: "A broad area of work.",
    });
    expect(createdSystem.status).toBe(200);
    const createdSystemBody: WebCommandResponse = await createdSystem.json();
    const systemId = createdSystemBody.result.systemId;
    if (!systemId) throw new Error("Expected created system id.");

    const created = await command({
      type: "CreateGoal",
      title: "Build the command loop",
      description: "Human-authored control through the Universe.",
      priority: "P1",
      systemId,
    });
    expect(created.status).toBe(200);
    const createdBody: WebCommandResponse = await created.json();
    const goalId = createdBody.result.goalId;
    if (!goalId) throw new Error("Expected created goal id.");
    expect(createdBody.portfolio.commandCentre.goals[0]?.title).toBe("Build the command loop");
    expect(createdBody.portfolio.commandCentre.systems[0]?.goals[0]?.id).toBe(goalId);

    expect(
      (await command({ type: "AssignGoalToSystem", goalId, systemId: undefined })).status,
    ).toBe(200);
    expect((await command({ type: "AssignGoalToSystem", goalId, systemId })).status).toBe(200);

    expect((await command({ type: "AssignAgents", agentIds: [agentId], goalId })).status).toBe(200);
    expect((await command({ type: "SetGoalPriority", goalId, priority: "P0" })).status).toBe(200);
    expect(
      (
        await command({
          type: "SetGoalMapPosition",
          goalId,
          position: { x: 240, y: -96 },
        })
      ).status,
    ).toBe(200);
    expect(fixture.universe.snapshot().goals[0]?.mapPosition).toEqual({ x: 240, y: -96 });
    expect(fixture.universe.snapshot().goals[0]?.mapPositionPinned).toBe(true);
    expect((await command({ type: "ResetGoalMapPosition", goalId })).status).toBe(200);
    expect(fixture.universe.snapshot().goals[0]?.mapPositionPinned).toBe(false);
    expect((await command({ type: "UnassignAgent", agentId })).status).toBe(200);
    fixture.clock.value += 1_000;
    admitObservedConversationsAndReconcile(fixture.universe, hostSnapshot([], fixture.clock.now()));
    expect((await command({ type: "ArchiveAgent", agentId })).status).toBe(200);
    expect((await command({ type: "CompleteGoal", goalId })).status).toBe(200);
    const archived = await command({ type: "ArchiveGoal", goalId });
    const archivedBody: WebCommandResponse = await archived.json();
    const acknowledged = await command({
      type: "AcknowledgeCatchUp",
      throughSequence: archivedBody.portfolio.catchUp.throughSequence,
      evidenceThroughSequence: archivedBody.portfolio.catchUp.evidenceThroughSequence,
    });
    const acknowledgedBody: WebCommandResponse = await acknowledged.json();

    expect(archived.status).toBe(200);
    expect(acknowledgedBody.portfolio.catchUp.pending).toBe(false);
    expect(fixture.universe.snapshot().goals[0]?.status).toBe("archived");
  });

  test("acknowledges the displayed semantic boundary, not newer changes", async () => {
    const fixture = makeUniverse();
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });
    fixture.universe.execute({ type: "CreateGoal", title: "Displayed" });
    const displayed = fixture.universe.project({ kind: "catch-up", now: fixture.clock.now() });
    if (displayed.kind !== "catch-up") throw new Error("Wrong projection");
    fixture.universe.execute({ type: "RenameGoal", goalId: "goal-1", title: "Unseen" });
    const response = await api.fetch(
      new Request("http://localhost/api/commands", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "x-ao-command": "1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: "AcknowledgeCatchUp",
          throughSequence: displayed.throughSequence,
          evidenceThroughSequence: 0,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body: WebCommandResponse = await response.json();
    expect(body.portfolio.catchUp).toMatchObject({ pending: true, transitionCount: 1 });
    expect(fixture.universe.snapshot().operatorCheckpoint?.lastSequence).toBe(
      displayed.throughSequence,
    );
  });

  test("rejects malformed, unsupported, and domain-invalid commands", async () => {
    const fixture = makeUniverse();
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
    });
    const request = (body: string): Promise<Response> =>
      api.fetch(
        new Request("http://localhost/api/commands", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-ao-command": "1",
          },
          body,
        }),
      );

    expect((await request("not-json")).status).toBe(400);
    const before = fixture.universe.snapshot();
    const invalidBoundaries = [
      {},
      { throughSequence: 0 },
      { evidenceThroughSequence: 0 },
      { throughSequence: -1, evidenceThroughSequence: 0 },
      { throughSequence: 0, evidenceThroughSequence: 0.5 },
      { throughSequence: Number.MAX_SAFE_INTEGER + 1, evidenceThroughSequence: 0 },
    ];
    const rejected = await Promise.all(
      invalidBoundaries.map((fields) =>
        request(JSON.stringify({ type: "AcknowledgeCatchUp", ...fields })),
      ),
    );
    expect(rejected.map((response) => response.status)).toEqual(invalidBoundaries.map(() => 400));
    expect(fixture.universe.snapshot()).toEqual(before);
    expect(
      (
        await request(
          JSON.stringify({
            type: "AcknowledgeCatchUp",
            throughSequence: 1,
            evidenceThroughSequence: 0,
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          JSON.stringify({
            type: "AcknowledgeCatchUp",
            throughSequence: 0,
            evidenceThroughSequence: 1,
          }),
        )
      ).status,
    ).toBe(409);
    expect(fixture.universe.snapshot()).toEqual(before);
    expect((await request(JSON.stringify({ type: "SetGoalMapPosition" }))).status).toBe(400);
    expect((await request(JSON.stringify({ type: "ArchiveGoal", goalId: "missing" }))).status).toBe(
      409,
    );
  });

  test("streams a host-owned terminal without exposing the host adapter to the client", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    admitObservedConversationsAndReconcile(
      fixture.universe,
      await Effect.runPromise(host.snapshot()),
    );
    const agent = fixture.universe
      .snapshot()
      .agents.find((candidate) => candidate.execution?.nativeId === "mock-p01");
    if (!agent) throw new Error("Expected the deterministic mock agent.");
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      host,
    });
    const mutation = (path: string, body: TerminalTestBody): Promise<Response> =>
      api.fetch(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "http://localhost",
            "x-ao-command": "1",
          },
          body: JSON.stringify(body),
        }),
      );

    const linksResponse = await api.fetch(
      new Request(`http://localhost/api/terminal/links?agentId=${encodeURIComponent(agent.id)}`),
    );
    const linksBody: WebTerminalLinksResponse = await linksResponse.json();
    const firstLink = linksBody.links.find((link) => link.available);
    expect(linksResponse.status).toBe(200);
    expect(linksBody.kind).toBe("terminal-links");
    expect(linksBody.links).toHaveLength(4);
    expect(firstLink).toBeDefined();
    expect(firstLink).not.toHaveProperty("target");
    const refreshedLinksResponse = await api.fetch(
      new Request(`http://localhost/api/terminal/links?agentId=${encodeURIComponent(agent.id)}`),
    );
    const refreshedLinksBody: WebTerminalLinksResponse = await refreshedLinksResponse.json();
    expect(refreshedLinksResponse.status).toBe(200);
    expect(refreshedLinksBody.links.find((link) => link.label === firstLink?.label)?.id).toBe(
      firstLink?.id,
    );

    const opened = await mutation("/api/terminal/open", {
      agentId: agent.id,
      dimensions: { columns: 480, rows: 180 },
    });
    expect(opened.status).toBe(200);
    const openedBody: WebTerminalOpenResponse = await opened.json();
    const sessionId = openedBody.sessionId;
    await Bun.sleep(1);
    const socketMessages: WebTerminalServerMessage[] = [];
    const connection = api.connectTerminalSocket(sessionId, (message) =>
      socketMessages.push(message),
    );
    expect(socketMessages.some((message) => message.kind === "frame")).toBe(true);
    await connection.receive(JSON.stringify({ kind: "input", value: "hello" }));
    await connection.receive(
      JSON.stringify({
        kind: "bytes",
        bytes: [0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75],
      }),
    );
    await connection.receive(
      JSON.stringify({
        kind: "scroll",
        direction: "up",
        lines: 12,
        source: "page-key",
      }),
    );
    await connection.receive(JSON.stringify({ kind: "resize", columns: 100, rows: 30 }));
    await connection.receive(JSON.stringify({ kind: "bytes", bytes: [256] }));
    expect(socketMessages.at(-1)).toEqual({
      kind: "error",
      message: "Terminal request does not match the contract.",
    });
    expect(
      (
        await mutation(`/api/terminal/${sessionId}/input`, {
          value: "legacy input",
        })
      ).status,
    ).toBe(404);
    const lastDeliveryId = Math.max(
      ...socketMessages.flatMap((message) =>
        message.kind === "error" || message.deliveryId === undefined ? [] : [message.deliveryId],
      ),
    );
    await connection.close();
    const resumedMessages: WebTerminalServerMessage[] = [];
    const resumedConnection = api.connectTerminalSocket(
      sessionId,
      (message) => resumedMessages.push(message),
      lastDeliveryId,
    );
    expect(resumedMessages).toEqual([]);
    await resumedConnection.receive(JSON.stringify({ kind: "input", value: "resumed" }));
    await Bun.sleep(1);
    expect(
      resumedMessages.some(
        (message) => message.kind === "frame" && message.deliveryId > lastDeliveryId,
      ),
    ).toBe(true);
    await resumedConnection.close();
    expect((await mutation(`/api/terminal/${sessionId}/release`, {})).status).toBe(200);

    const linkedOpened = await mutation("/api/terminal/open", {
      agentId: agent.id,
      dimensions: { columns: 80, rows: 24 },
      linkId: firstLink!.id,
    });
    expect(linkedOpened.status).toBe(200);
    const linkedBody: WebTerminalOpenResponse = await linkedOpened.json();
    expect((await mutation(`/api/terminal/${linkedBody.sessionId}/release`, {})).status).toBe(200);

    const newTerminal = linksBody.links.find((link) => link.source === "prepared");
    expect(newTerminal?.label).toBe("New terminal");
    const firstNew = await mutation("/api/terminal/open", {
      agentId: agent.id,
      dimensions: { columns: 80, rows: 24 },
      linkId: newTerminal!.id,
    });
    const secondNew = await mutation("/api/terminal/open", {
      agentId: agent.id,
      dimensions: { columns: 80, rows: 24 },
      linkId: newTerminal!.id,
    });
    expect(firstNew.status).toBe(200);
    expect(secondNew.status).toBe(200);
    const firstNewBody: WebTerminalOpenResponse = await firstNew.json();
    const secondNewBody: WebTerminalOpenResponse = await secondNew.json();
    expect(firstNewBody.message).toContain("terminal 1");
    expect(secondNewBody.message).toContain("terminal 2");
    expect((await mutation(`/api/terminal/${firstNewBody.sessionId}/release`, {})).status).toBe(
      200,
    );
    expect((await mutation(`/api/terminal/${secondNewBody.sessionId}/release`, {})).status).toBe(
      200,
    );
    await api.close();
  });

  test("opens a host terminal for a pending blank launch without creating an Agent", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    const launched = await Effect.runPromise(
      host.launchExecution({
        workingDirectory: "/synthetic/project",
        agentName: "Blank Codex launch",
        processPlan: { harnessId: "codex", executable: "codex", args: [] },
        requestId: "pending-terminal-test",
      }),
    );
    if (!launched.executionRef) throw new Error("Expected a pending host execution.");
    const coordinator: StartAgentCoordinator = {
      start: () => Effect.die("not used"),
      resume: () => Effect.die("not used"),
      refreshPending: () => Effect.succeed([]),
      pendingLaunches: () => [
        {
          requestId: "pending-terminal-test",
          harnessId: "codex",
          executionRef: launched.executionRef!,
          displayName: "Blank Codex launch",
          message: "Waiting for the first message.",
        },
      ],
    };
    const workspace: WorkspaceProvider = {
      listChoices: () => Effect.succeed([]),
      prepare: () => Effect.die("not used"),
    };
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      host,
      launch: { coordinator, workspace },
    });

    const opened = await api.fetch(
      new Request("http://localhost/api/terminal/open", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: JSON.stringify({
          requestId: "pending-terminal-test",
          dimensions: { columns: 100, rows: 30 },
        }),
      }),
    );

    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({
      message: expect.stringContaining("mock terminal"),
    });
    expect(fixture.universe.snapshot().agents).toEqual([]);
    await api.close();
  });

  test("closes host Agents before archiving them through the closeout endpoint", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    let canonicalHostObservations = 0;
    const conversations: ConversationTrackerModule = {
      refresh: () =>
        Effect.succeed({
          observedProviders: 0,
          discoveredConversations: 0,
          diagnostics: [],
        }),
      history: () => [],
      add: () => {
        throw new Error("Conversation add is not used by closeout.");
      },
      observeHost: (snapshot) => {
        canonicalHostObservations += 1;
        return admitObservedConversationsAndReconcile(fixture.universe, snapshot);
      },
    };
    admitObservedConversationsAndReconcile(
      fixture.universe,
      await Effect.runPromise(host.snapshot()),
    );
    const agent = fixture.universe
      .snapshot()
      .agents.find((candidate) => candidate.execution?.nativeId === "mock-p01");
    if (!agent) throw new Error("Expected the deterministic mock Agent.");
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      host,
      conversations,
    });

    const response = await api.fetch(
      new Request("http://localhost/api/closeout/close", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: JSON.stringify({ agentIds: [agent.id] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({
      ok: true,
      results: [{ agentId: agent.id, status: "closed-and-archived" }],
    });
    expect(canonicalHostObservations).toBe(2);
    expect(body.portfolio.commandCentre.counts.agents).toBe(19);
    expect(
      fixture.universe.snapshot().agents.find((candidate) => candidate.id === agent.id),
    ).toMatchObject({
      hostHealth: "stale",
      archivedAt: fixture.clock.now(),
    });

    const foreign = await api.fetch(
      new Request("http://localhost/api/closeout/close", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://foreign" },
        body: JSON.stringify({ agentIds: [agent.id] }),
      }),
    );
    expect(foreign.status).toBe(403);
  });

  test("protects terminal mutations with the browser command boundary", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    admitObservedConversationsAndReconcile(
      fixture.universe,
      await Effect.runPromise(host.snapshot()),
    );
    const agent = fixture.universe.snapshot().agents[0];
    if (!agent) throw new Error("Expected a deterministic mock agent.");
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      host,
    });
    const response = await api.fetch(
      new Request("http://localhost/api/terminal/open", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
          "x-ao-command": "1",
        },
        body: JSON.stringify({
          agentId: agent.id,
          dimensions: { columns: 80, rows: 24 },
        }),
      }),
    );

    expect(response.status).toBe(403);
  });

  test("does not enable closeout without the canonical conversation observer", async () => {
    const fixture = makeUniverse();
    const host = new MockHostAdapter({ clock: fixture.clock });
    const api = new ObservatoryWebApi({
      universe: fixture.universe,
      clock: fixture.clock,
      allowedOrigin: "http://localhost",
      host,
    });

    const response = await api.fetch(
      new Request("http://localhost/api/closeout/close", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost",
          "x-ao-command": "1",
        },
        body: JSON.stringify({ agentIds: ["agent-1"] }),
      }),
    );

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Agent closeout is unavailable." });
  });
});
