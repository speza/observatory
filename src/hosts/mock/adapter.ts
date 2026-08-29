import { Effect, Stream } from "effect";
import type { Clock } from "../../universe/types.ts";
import type {
  HostActionResult,
  HostExecutionLaunchRequest,
  HostLaunchResult,
  HostAgentObservation,
  HostSnapshot,
  HostTerminalEvent,
  HostedTerminalSession,
  OpaqueAccessTarget,
  AgentAccess,
  SessionHost,
  TerminalDimensions,
  TerminalOpenOptions,
  HostTerminalInput,
  HostTerminalOpenResult,
  LinkedExecution,
} from "../types.ts";
import { hostError, type HostError } from "../errors.ts";
import { createMockScenario, type MockFrame, type MockScenario } from "./scenarios.ts";

const parseTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "mock-agent" ? target.token : undefined;

const parseLinkedExecutionTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "mock-linked-execution" ? target.token : undefined;

const elapsedFrames = (now: number, startedAt: number, tickMs: number): number =>
  Math.floor(Math.max(0, now - startedAt) / tickMs);

class MockTerminalSession implements HostedTerminalSession {
  readonly events: Stream.Stream<HostTerminalEvent, HostError>;
  readonly inputs: HostTerminalInput[] = [];
  readonly resizes: TerminalDimensions[] = [];
  private readonly queued: HostTerminalEvent[];
  private readonly waiters: (() => void)[] = [];
  private released = false;

  constructor(
    private readonly agentName: string,
    dimensions: TerminalDimensions,
  ) {
    this.queued = [
      {
        kind: "frame",
        frame: {
          bytes: new TextEncoder().encode(
            `\u001b[2J\u001b[H\u001b[1;36mMOCK TERMINAL\u001b[0m\r\n${agentName}\r\n\r\nType here; Ctrl-Q releases this deterministic agent.\r\n`,
          ),
          columns: dimensions.columns,
          rows: dimensions.rows,
          full: true,
        },
      },
    ];
    this.events = Stream.fromAsyncIterable(this.readEvents(), () =>
      hostError("mock-terminal.events", `Mock terminal stream failed for ${agentName}.`),
    );
  }

  send(input: HostTerminalInput): Effect.Effect<HostActionResult, HostError> {
    return Effect.sync(() => {
      if (this.released) return { ok: false, message: "The mock terminal has been released." };
      this.inputs.push(input);
      const value =
        input.kind === "text"
          ? input.value
          : input.kind === "bytes"
            ? new TextDecoder().decode(input.value)
            : `${input.source} ${input.direction} ${input.lines}`;
      this.push({
        kind: "frame",
        frame: { bytes: new TextEncoder().encode(`\r\nmock input: ${JSON.stringify(value)}\r\n`) },
      });
      return { ok: true, message: "Input sent to the mock terminal." };
    });
  }

  resize(dimensions: TerminalDimensions): Effect.Effect<HostActionResult, HostError> {
    return Effect.sync(() => {
      if (this.released) return { ok: false, message: "The mock terminal has been released." };
      if (dimensions.columns < 1 || dimensions.rows < 1)
        return { ok: false, message: "Terminal dimensions must be positive." };
      this.resizes.push(dimensions);
      return {
        ok: true,
        message: `Resized mock terminal to ${dimensions.columns}×${dimensions.rows}.`,
      };
    });
  }

  release(): Effect.Effect<HostActionResult, HostError> {
    return Effect.sync(() => {
      if (this.released) return { ok: true, message: "Mock terminal already released." };
      this.released = true;
      this.push({ kind: "closed", reason: "Released by Observatory." });
      return { ok: true, message: `Released mock terminal ${this.agentName}.` };
    });
  }

  private async *readEvents(): AsyncIterable<HostTerminalEvent> {
    while (true) {
      const next = this.queued.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.released) return;
      // This is an ordered event stream; concurrent waits would lose its wake-up semantics.
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private push(event: HostTerminalEvent): void {
    this.queued.push(event);
    this.waiters.shift()?.();
  }
}

/**
 * A deterministic development host. It exercises the same reconciliation,
 * projection, attention and attachment paths as Herdr without inventing a
 * renderer-only fixture or copying any private agent content.
 */
export class MockHostAdapter implements SessionHost {
  private readonly clock: Clock;
  private readonly scenario: MockScenario;
  private readonly startedAt: number;
  private readonly liveTargets = new Map<string, OpaqueAccessTarget>();
  private readonly liveLinkedExecutionTargets = new Map<string, string>();
  private readonly liveLinkedExecutions = new Map<string, readonly LinkedExecution[]>();
  private readonly launched = new Map<string, HostAgentObservation>();
  private readonly closed = new Set<string>();
  private launchSequence = 0;
  private linkedTerminalSequence = 0;

  constructor(options: {
    readonly clock: Clock;
    readonly scenario?: MockScenario;
    readonly tickMs?: number;
  }) {
    this.clock = options.clock;
    const scenario = options.scenario ?? createMockScenario();
    if (scenario.frames.length === 0)
      throw new Error("A mock scenario must contain at least one frame.");
    const tickMs = options.tickMs ?? scenario.tickMs;
    if (!Number.isFinite(tickMs) || tickMs <= 0)
      throw new Error("Mock scenario tickMs must be greater than zero.");
    this.scenario = { ...scenario, tickMs };
    this.startedAt = this.clock.now();
  }

  private currentFrame(): MockFrame {
    const frameNumber =
      elapsedFrames(this.clock.now(), this.startedAt, this.scenario.tickMs) %
      this.scenario.frames.length;
    const frame = this.scenario.frames[frameNumber];
    if (!frame) throw new Error("Mock scenario frame disappeared.");
    return frame;
  }

  private actionFailure(): HostActionResult | undefined {
    const message = this.currentFrame().actionError;
    return message ? { ok: false, message } : undefined;
  }

  snapshot(): Effect.Effect<HostSnapshot, HostError> {
    return Effect.sync(() => {
      this.liveTargets.clear();
      this.liveLinkedExecutionTargets.clear();
      this.liveLinkedExecutions.clear();
      const observedAt = this.clock.now();
      const frame = this.currentFrame();
      const available = frame.available ?? true;
      const agents = [
        ...frame.agents.map((agent) => ({
          ...agent,
          observedAt,
        })),
        ...Array.from(this.launched.values(), (agent) => ({ ...agent, observedAt })),
      ].filter((agent) => available && !this.closed.has(agent.nativeId));
      for (const agent of agents) {
        this.liveTargets.set(agent.nativeId, {
          kind: "mock-agent",
          token: agent.nativeId,
        });
        if (agent.worktree) {
          const shellToken = `${agent.nativeId}:shell`;
          const watcherToken = `${agent.nativeId}:watcher`;
          const siblingToken = `${agent.nativeId}:sibling-agent`;
          this.liveLinkedExecutionTargets.set(shellToken, agent.nativeId);
          this.liveLinkedExecutionTargets.set(watcherToken, agent.nativeId);
          this.liveLinkedExecutionTargets.set(siblingToken, agent.nativeId);
          this.liveLinkedExecutions.set(agent.nativeId, [
            {
              kind: "shell",
              label: "Mock linked shell",
              owner: { kind: "mock-agent", token: agent.nativeId },
              workingDirectory: agent.worktree,
              target: { kind: "mock-linked-execution", token: shellToken },
              available: true,
              source: "observed",
              explanation: "Deterministic linked shell for the selected mock agent.",
            },
            {
              kind: "shell",
              label: "Mock test watcher",
              owner: { kind: "mock-agent", token: agent.nativeId },
              workingDirectory: agent.worktree,
              target: { kind: "mock-linked-execution", token: watcherToken },
              available: true,
              source: "observed",
              explanation: "Deterministic second linked shell for the selected mock agent.",
            },
            {
              kind: "agent",
              label: "Mock sibling agent",
              owner: { kind: "mock-agent", token: agent.nativeId },
              workingDirectory: agent.worktree,
              target: { kind: "mock-linked-execution", token: siblingToken },
              available: true,
              source: "observed",
              explanation: "Deterministic sibling agent surface in the same host context.",
            },
            {
              kind: "shell",
              label: "New terminal",
              owner: { kind: "mock-agent", token: agent.nativeId },
              workingDirectory: agent.worktree,
              target: { kind: "mock-prepared-shell", token: agent.worktree },
              available: true,
              source: "prepared",
              explanation: `Create a new mock terminal in ${agent.worktree}.`,
            },
          ]);
        }
      }
      const snapshot: HostSnapshot = {
        hostKind: "mock",
        hostInstanceId: "mock:default",
        available,
        observedAt,
        agents,
        diagnostics: frame.diagnostics ?? [],
      };
      if (frame.error) Object.assign(snapshot, { error: frame.error });
      return snapshot;
    }).pipe(
      Effect.catchAllDefect(() =>
        Effect.fail(hostError("host.snapshot", "Mock scenario snapshot failed unexpectedly.")),
      ),
    );
  }

  launchExecution(request: HostExecutionLaunchRequest): Effect.Effect<HostLaunchResult, HostError> {
    return Effect.sync(() => {
      const failure = this.actionFailure();
      if (failure) return failure;
      const harnessId = request.processPlan.harnessId.trim();
      if (!harnessId)
        return { ok: false, message: "A mock harness id is required." } satisfies HostLaunchResult;
      const id = `mock-launch-${++this.launchSequence}`;
      const displayName = request.agentName?.trim() || `${harnessId} agent ${this.launchSequence}`;
      const nativeConversationRef = request.processPlan.nativeConversationRef ?? {
        harnessId,
        kind: "session-id",
        value: `mock-conversation-${this.launchSequence}`,
      };
      const agent: HostAgentObservation = {
        nativeId: id,
        displayName,
        runtimeState: "working",
        runtimeStateSource: "mock.launch",
        observedAt: this.clock.now(),
        repository: "synthetic/ao-playground",
        branch: "mock/launch",
        worktree: request.workingDirectory,
        provider: harnessId,
        harnessEvidence: {
          detectedHarnessId: harnessId,
          nativeConversationRef,
          restoreState: "not-restored",
          source: "native-integration",
          observedAt: this.clock.now(),
        },
        hostLocator: `mock-agent:${id}`,
      };
      this.launched.set(id, agent);
      return {
        ok: true,
        executionRef: id,
        message: `Started a mock ${harnessId} agent in ${request.workingDirectory}.`,
      } satisfies HostLaunchResult;
    });
  }

  access(agent: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Effect.Effect<AgentAccess, HostError> {
    return Effect.sync(() => {
      if (agent.hostKind !== "mock")
        return {
          supported: false,
          capabilities: [],
          linkedExecutions: [],
          explanation: "This agent belongs to an unsupported host.",
        } satisfies AgentAccess;
      const target = this.liveTargets.get(agent.nativeId);
      if (!target)
        return {
          supported: false,
          capabilities: [],
          linkedExecutions: [],
          explanation: "The agent is not present in the latest mock frame.",
        } satisfies AgentAccess;
      const linkedExecutions = this.liveLinkedExecutions.get(agent.nativeId) ?? [];
      return {
        supported: true,
        capabilities: [
          "embedded-terminal",
          "native-handoff",
          "close-agent",
          ...(linkedExecutions.some((linkedExecution) => linkedExecution.available)
            ? ["linked-terminal" as const]
            : []),
        ],
        mode: "focus",
        target,
        terminalTarget: {
          kind: "mock-terminal",
          token: agent.nativeId,
        },
        linkedExecutions,
        explanation: "Simulate focus or open an embedded terminal in the deterministic mock host.",
      } satisfies AgentAccess;
    });
  }

  activate(access: AgentAccess): Effect.Effect<HostActionResult, HostError> {
    return Effect.sync(() => {
      const failure = this.actionFailure();
      if (failure) return failure;
      if (!access.supported || !access.target) return { ok: false, message: access.explanation };
      const token = parseTarget(access.target);
      if (!token)
        return {
          ok: false,
          message: "The mock attachment target is invalid or unsupported.",
        };
      if (!this.liveTargets.has(token))
        return {
          ok: false,
          message: "The agent is no longer present in the latest mock frame.",
        };
      return { ok: true, message: `Simulated focus for mock agent ${token}.` };
    });
  }

  closeAgent(access: AgentAccess): Effect.Effect<HostActionResult, HostError> {
    return Effect.sync(() => {
      const failure = this.actionFailure();
      if (failure) return failure;
      if (!access.supported || !access.target) return { ok: false, message: access.explanation };
      const token = parseTarget(access.target);
      if (!token)
        return {
          ok: false,
          message: "The mock close target is invalid or unsupported.",
        };
      if (!this.liveTargets.has(token)) {
        if (this.closed.has(token))
          return { ok: true, message: `Mock agent ${token} had already ended.` };
        return { ok: false, message: "The agent is no longer present in the latest mock frame." };
      }
      this.closed.add(token);
      this.launched.delete(token);
      this.liveTargets.delete(token);
      return { ok: true, message: `Closed mock agent ${token}.` };
    });
  }

  openTerminal(
    access: AgentAccess,
    dimensions: TerminalDimensions,
    _options?: TerminalOpenOptions,
  ): Effect.Effect<HostTerminalOpenResult, HostError> {
    return Effect.sync(() => {
      const failure = this.actionFailure();
      if (failure) return failure;
      if (!access.supported || !access.terminalTarget)
        return {
          ok: false,
          message: "This mock agent does not expose an embedded terminal.",
        } satisfies HostTerminalOpenResult;
      if (access.terminalTarget.kind !== "mock-terminal")
        return {
          ok: false,
          message: "The mock terminal target is invalid or unsupported.",
        } satisfies HostTerminalOpenResult;
      if (dimensions.columns < 1 || dimensions.rows < 1)
        return {
          ok: false,
          message: "Terminal dimensions must be positive.",
        } satisfies HostTerminalOpenResult;
      if (!this.liveTargets.has(access.terminalTarget.token))
        return {
          ok: false,
          message: "The agent is no longer present in the latest mock frame.",
        } satisfies HostTerminalOpenResult;
      return {
        ok: true,
        message: `Opened an embedded mock terminal for ${access.terminalTarget.token}.`,
        terminal: new MockTerminalSession(access.terminalTarget.token, dimensions),
      } satisfies HostTerminalOpenResult;
    });
  }

  openLinkedExecutionTerminal(
    linkedExecution: LinkedExecution,
    dimensions: TerminalDimensions,
    _options?: TerminalOpenOptions,
  ): Effect.Effect<HostTerminalOpenResult, HostError> {
    return Effect.sync(() => {
      const failure = this.actionFailure();
      if (failure) return failure;
      if (!linkedExecution.available || !linkedExecution.target)
        return {
          ok: false,
          message: linkedExecution.explanation,
        } satisfies HostTerminalOpenResult;
      if (linkedExecution.source === "prepared") {
        const ownerToken = parseTarget(linkedExecution.owner);
        if (
          linkedExecution.target.kind !== "mock-prepared-shell" ||
          !ownerToken ||
          !this.liveTargets.has(ownerToken) ||
          linkedExecution.target.token !== linkedExecution.workingDirectory
        )
          return {
            ok: false,
            message: "The mock new-terminal capability is invalid or no longer available.",
          } satisfies HostTerminalOpenResult;
        if (dimensions.columns < 1 || dimensions.rows < 1)
          return {
            ok: false,
            message: "Terminal dimensions must be positive.",
          } satisfies HostTerminalOpenResult;
        const sequence = ++this.linkedTerminalSequence;
        return {
          ok: true,
          message: `Opened mock companion terminal ${sequence} in ${linkedExecution.workingDirectory}.`,
          terminal: new MockTerminalSession(`New terminal ${sequence}`, dimensions),
        } satisfies HostTerminalOpenResult;
      }
      const token = parseLinkedExecutionTarget(linkedExecution.target);
      if (!token)
        return {
          ok: false,
          message: "The mock linked terminal target is invalid or unsupported.",
        } satisfies HostTerminalOpenResult;
      if (!this.liveLinkedExecutionTargets.has(token))
        return {
          ok: false,
          message: "The selected linked execution is no longer available.",
        } satisfies HostTerminalOpenResult;
      const owner = linkedExecution.owner;
      const ownerToken = parseTarget(owner);
      if (!ownerToken || this.liveLinkedExecutionTargets.get(token) !== ownerToken)
        return {
          ok: false,
          message: "The selected linked execution belongs to a different mock agent.",
        } satisfies HostTerminalOpenResult;
      if (dimensions.columns < 1 || dimensions.rows < 1)
        return {
          ok: false,
          message: "Terminal dimensions must be positive.",
        } satisfies HostTerminalOpenResult;
      return {
        ok: true,
        message: `Opened a mock linked terminal for ${token}.`,
        terminal: new MockTerminalSession(linkedExecution.label, dimensions),
      } satisfies HostTerminalOpenResult;
    });
  }
}
