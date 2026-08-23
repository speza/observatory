import { Effect, Stream } from "effect";
import type { Clock } from "../../universe/types.ts";
import type {
  HostActionResult,
  HostLaunchOption,
  HostLaunchRequest,
  HostLaunchResult,
  HostSessionObservation,
  HostSnapshot,
  HostTerminalEvent,
  HostedTerminalSession,
  OpaqueAccessTarget,
  SessionAccess,
  SessionHost,
  TerminalDimensions,
  HostTerminalInput,
  HostTerminalOpenResult,
} from "../types.ts";
import { hostError, type HostError } from "../errors.ts";
import { createMockScenario, type MockScenario } from "./scenarios.ts";

const parseTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "mock-session" ? target.token : undefined;

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
    private readonly sessionName: string,
    dimensions: TerminalDimensions,
  ) {
    this.queued = [
      {
        kind: "frame",
        frame: {
          bytes: new TextEncoder().encode(
            `\u001b[2J\u001b[H\u001b[1;36mMOCK TERMINAL\u001b[0m\r\n${sessionName}\r\n\r\nType here; Ctrl-Q releases this deterministic session.\r\n`,
          ),
          columns: dimensions.columns,
          rows: dimensions.rows,
          full: true,
        },
      },
    ];
    this.events = Stream.fromAsyncIterable(this.readEvents(), () =>
      hostError("mock-terminal.events", `Mock terminal stream failed for ${sessionName}.`),
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
      return { ok: true, message: `Released mock terminal ${this.sessionName}.` };
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
 * renderer-only fixture or copying any private session content.
 */
export class MockHostAdapter implements SessionHost {
  private readonly clock: Clock;
  private readonly scenario: MockScenario;
  private readonly startedAt: number;
  private readonly liveTargets = new Map<string, OpaqueAccessTarget>();
  private readonly launched = new Map<string, HostSessionObservation>();
  private launchSequence = 0;

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

  snapshot(): Effect.Effect<HostSnapshot, HostError> {
    return Effect.sync(() => {
      this.liveTargets.clear();
      const observedAt = this.clock.now();
      const frameNumber =
        elapsedFrames(observedAt, this.startedAt, this.scenario.tickMs) %
        this.scenario.frames.length;
      const frame = this.scenario.frames[frameNumber];
      if (!frame) throw new Error("Mock scenario frame disappeared.");
      const sessions = [
        ...frame.sessions.map((session) => ({
          ...session,
          observedAt,
        })),
        ...Array.from(this.launched.values(), (session) => ({ ...session, observedAt })),
      ];
      for (const session of sessions) {
        this.liveTargets.set(session.nativeId, {
          kind: "mock-session",
          token: session.nativeId,
        });
      }
      return {
        hostKind: "mock",
        available: true,
        observedAt,
        sessions,
        diagnostics: [],
      } satisfies HostSnapshot;
    }).pipe(
      Effect.catchAllDefect(() =>
        Effect.fail(hostError("host.snapshot", "Mock scenario snapshot failed unexpectedly.")),
      ),
    );
  }

  listLaunchOptions(): Effect.Effect<readonly HostLaunchOption[], HostError> {
    return Effect.succeed([
      { kind: "claude", label: "Claude Code", description: "Claude Code CLI" },
      { kind: "codex", label: "Codex", description: "Codex CLI" },
      { kind: "pi", label: "Pi", description: "Pi coding agent" },
    ]);
  }

  launch(request: HostLaunchRequest): Effect.Effect<HostLaunchResult, HostError> {
    return Effect.sync(() => {
      const agentKind = request.agentKind.trim();
      if (!agentKind)
        return { ok: false, message: "A mock agent kind is required." } satisfies HostLaunchResult;
      const id = `mock-launch-${++this.launchSequence}`;
      const displayName =
        request.agentName?.trim() || `${agentKind} session ${this.launchSequence}`;
      const session: HostSessionObservation = {
        nativeId: id,
        displayName,
        runtimeState: "working",
        runtimeStateSource: "mock.launch",
        observedAt: this.clock.now(),
        repository: "synthetic/ao-playground",
        branch: "mock/launch",
        worktree: request.workingDirectory,
        provider: agentKind,
        hostLocator: `mock-session:${id}`,
      };
      this.launched.set(id, session);
      return {
        ok: true,
        nativeId: id,
        message: `Started a mock ${agentKind} session in ${request.workingDirectory}.`,
      } satisfies HostLaunchResult;
    });
  }

  access(session: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Effect.Effect<SessionAccess, HostError> {
    return Effect.sync(() => {
      if (session.hostKind !== "mock")
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
          explanation: "The session is not present in the latest mock frame.",
        } satisfies SessionAccess;
      return {
        supported: true,
        capabilities: ["embedded-terminal", "native-handoff"],
        mode: "focus",
        target,
        terminalTarget: {
          kind: "mock-terminal",
          token: session.nativeId,
        },
        explanation: "Simulate focus or open an embedded terminal in the deterministic mock host.",
      } satisfies SessionAccess;
    });
  }

  activate(access: SessionAccess): Effect.Effect<HostActionResult, HostError> {
    return Effect.sync(() => {
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
          message: "The session is no longer present in the latest mock frame.",
        };
      return { ok: true, message: `Simulated focus for mock session ${token}.` };
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
          message: "This mock session does not expose an embedded terminal.",
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
          message: "The session is no longer present in the latest mock frame.",
        } satisfies HostTerminalOpenResult;
      return {
        ok: true,
        message: `Opened an embedded mock terminal for ${access.terminalTarget.token}.`,
        terminal: new MockTerminalSession(access.terminalTarget.token, dimensions),
      } satisfies HostTerminalOpenResult;
    });
  }
}
