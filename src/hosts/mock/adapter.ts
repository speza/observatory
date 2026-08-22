import type { Clock } from "../../universe/types.ts";
import type {
  HostActionResult,
  HostSnapshot,
  OpaqueAccessTarget,
  SessionAccess,
  SessionHost,
} from "../types.ts";
import { createMockScenario, type MockScenario } from "./scenarios.ts";

const parseTarget = (target: OpaqueAccessTarget): string | undefined =>
  target.kind === "mock-session" ? target.token : undefined;

const elapsedFrames = (now: number, startedAt: number, tickMs: number): number =>
  Math.floor(Math.max(0, now - startedAt) / tickMs);

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

  async snapshot(): Promise<HostSnapshot> {
    this.liveTargets.clear();
    const observedAt = this.clock.now();
    const frameNumber =
      elapsedFrames(observedAt, this.startedAt, this.scenario.tickMs) % this.scenario.frames.length;
    const frame = this.scenario.frames[frameNumber];
    if (!frame) throw new Error("Mock scenario frame disappeared.");
    const sessions = frame.sessions.map((session) => ({
      ...session,
      observedAt,
    }));
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
    };
  }

  async access(session: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Promise<SessionAccess> {
    if (session.hostKind !== "mock")
      return {
        supported: false,
        explanation: "This session belongs to an unsupported host.",
      };
    const target = this.liveTargets.get(session.nativeId);
    if (!target)
      return {
        supported: false,
        explanation: "The session is not present in the latest mock frame.",
      };
    return {
      supported: true,
      mode: "focus",
      target,
      explanation: "Simulate focus in the deterministic mock host.",
    };
  }

  async activate(access: SessionAccess): Promise<HostActionResult> {
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
  }
}
