import { Effect, Schema, Stream } from "effect";
import {
  hasAgentCapability,
  type HostedTerminalSession,
  type SessionHost,
} from "../hosts/types.ts";
import type { Universe } from "../universe/universe.ts";
import type {
  WebTerminalActionResponse,
  WebTerminalEvent,
  WebTerminalOpenResponse,
  WebTerminalScrollRequest,
} from "./protocol.ts";

const MAX_TERMINAL_BODY_BYTES = 65_536;
const MAX_REPLAY_EVENTS = 128;
const SessionId = Schema.String.pipe(Schema.pattern(/^[0-9a-f-]{36}$/u));
const Dimensions = Schema.Struct({
  columns: Schema.Number.pipe(Schema.int(), Schema.between(20, 320)),
  rows: Schema.Number.pipe(Schema.int(), Schema.between(5, 120)),
});
const OpenRequest = Schema.Struct({
  agentId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160)),
  dimensions: Dimensions,
});
const TextInputRequest = Schema.Struct({
  value: Schema.String.pipe(Schema.maxLength(32_768)),
});
const ScrollInputRequest = Schema.Struct({
  kind: Schema.Literal("scroll"),
  direction: Schema.Literal("up", "down"),
  lines: Schema.Number.pipe(Schema.int(), Schema.between(1, 512)),
  source: Schema.Literal("wheel", "page-key"),
});
const InputRequest = Schema.Union(TextInputRequest, ScrollInputRequest);

interface ActiveTerminal {
  readonly terminal: HostedTerminalSession;
  readonly replay: WebTerminalEvent[];
  readonly listeners: Set<(event: WebTerminalEvent) => void>;
  closed: boolean;
}

export class WebTerminalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const decode = <A>(schema: Schema.Schema<A>, text: string): A => {
  if (text.length > MAX_TERMINAL_BODY_BYTES)
    throw new WebTerminalError("Terminal request is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(schema))(text);
  } catch {
    throw new WebTerminalError("Terminal request does not match the contract.", 400);
  }
};

const encodedEvent = (event: WebTerminalEvent): Uint8Array =>
  new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const terminalHeartbeat = new TextEncoder().encode(": keepalive\n\n");
const noOperation = (): void => undefined;

export class WebTerminalGateway {
  private readonly sessions = new Map<string, ActiveTerminal>();

  constructor(
    private readonly universe: Universe,
    private readonly host: SessionHost,
  ) {}

  async open(body: string): Promise<WebTerminalOpenResponse> {
    const request = decode(OpenRequest, body);
    const agent = this.universe
      .snapshot()
      .agents.find(
        (candidate) => candidate.id === request.agentId && candidate.archivedAt === undefined,
      );
    if (!agent) throw new WebTerminalError("Active agent not found.", 404);
    try {
      const access = await Effect.runPromise(
        this.host.access({ hostKind: agent.hostKind, nativeId: agent.nativeId }),
      );
      if (!hasAgentCapability(access, "embedded-terminal") || !access.terminalTarget)
        throw new WebTerminalError(access.explanation, 409);
      const opened = await Effect.runPromise(this.host.openTerminal(access, request.dimensions));
      if (!opened.ok || !opened.terminal) throw new WebTerminalError(opened.message, 409);
      const sessionId = crypto.randomUUID();
      const active: ActiveTerminal = {
        terminal: opened.terminal,
        replay: [],
        listeners: new Set(),
        closed: false,
      };
      this.sessions.set(sessionId, active);
      void this.consume(sessionId, active);
      return { sessionId, message: opened.message };
    } catch (error) {
      if (error instanceof WebTerminalError) throw error;
      throw new WebTerminalError("The host could not open this terminal.", 502);
    }
  }

  events(rawSessionId: string): Response {
    const sessionId = this.validSessionId(rawSessionId);
    const active = this.session(sessionId);
    let unsubscribe = noOperation;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        for (const event of active.replay) {
          controller.enqueue(encodedEvent(event));
          if (event.kind === "closed") {
            controller.close();
            return;
          }
        }
        const listener = (event: WebTerminalEvent): void => {
          controller.enqueue(encodedEvent(event));
          if (event.kind === "closed") {
            unsubscribe();
            controller.close();
          }
        };
        active.listeners.add(listener);
        unsubscribe = () => {
          active.listeners.delete(listener);
          if (heartbeat) clearInterval(heartbeat);
        };
        heartbeat = setInterval(() => controller.enqueue(terminalHeartbeat), 5_000);
      },
      cancel: () => unsubscribe(),
    });
    return new Response(stream, {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/event-stream; charset=utf-8",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      },
    });
  }

  async input(rawSessionId: string, body: string): Promise<WebTerminalActionResponse> {
    const active = this.session(this.validSessionId(rawSessionId));
    const request = decode(InputRequest, body);
    const input: Parameters<HostedTerminalSession["send"]>[0] =
      "value" in request
        ? { kind: "text", value: request.value }
        : (request satisfies WebTerminalScrollRequest);
    return this.action(active.terminal.send(input));
  }

  async resize(rawSessionId: string, body: string): Promise<WebTerminalActionResponse> {
    const active = this.session(this.validSessionId(rawSessionId));
    return this.action(active.terminal.resize(decode(Dimensions, body)));
  }

  async release(rawSessionId: string): Promise<WebTerminalActionResponse> {
    const sessionId = this.validSessionId(rawSessionId);
    const active = this.session(sessionId);
    const result = await this.action(active.terminal.release());
    this.sessions.delete(sessionId);
    return result;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(
      sessions.map((active) => Effect.runPromise(active.terminal.release())),
    );
  }

  private async action(
    effect: ReturnType<HostedTerminalSession["send"]>,
  ): Promise<WebTerminalActionResponse> {
    try {
      const result = await Effect.runPromise(effect);
      if (!result.ok) throw new WebTerminalError(result.message, 409);
      return { ok: true, message: result.message };
    } catch (error) {
      if (error instanceof WebTerminalError) throw error;
      throw new WebTerminalError("The host terminal action failed.", 502);
    }
  }

  private async consume(sessionId: string, active: ActiveTerminal): Promise<void> {
    try {
      await Effect.runPromise(
        Stream.runForEach(active.terminal.events, (event) =>
          Effect.sync(() => {
            if (event.kind === "closed") {
              this.publish(active, { kind: "closed", reason: event.reason });
              return;
            }
            const message: WebTerminalEvent = {
              kind: "frame",
              bytes: Buffer.from(event.frame.bytes).toString("base64"),
            };
            if (event.frame.columns !== undefined)
              Object.assign(message, { columns: event.frame.columns });
            if (event.frame.rows !== undefined) Object.assign(message, { rows: event.frame.rows });
            if (event.frame.sequence !== undefined)
              Object.assign(message, { sequence: event.frame.sequence });
            if (event.frame.full !== undefined) Object.assign(message, { full: event.frame.full });
            this.publish(active, message);
          }),
        ),
      );
      if (!active.closed)
        this.publish(active, { kind: "closed", reason: "Terminal stream ended." });
    } catch {
      if (!active.closed)
        this.publish(active, { kind: "closed", reason: "Terminal stream failed." });
    } finally {
      if (active.closed && active.listeners.size === 0) this.sessions.delete(sessionId);
    }
  }

  private publish(active: ActiveTerminal, event: WebTerminalEvent): void {
    if (active.closed) return;
    active.replay.push(event);
    if (active.replay.length > MAX_REPLAY_EVENTS)
      active.replay.splice(0, active.replay.length - MAX_REPLAY_EVENTS);
    if (event.kind === "closed") active.closed = true;
    for (const listener of active.listeners) listener(event);
    if (event.kind === "closed") active.listeners.clear();
  }

  private validSessionId(raw: string): string {
    try {
      return Schema.decodeUnknownSync(SessionId)(raw);
    } catch {
      throw new WebTerminalError("Terminal session id is invalid.", 400);
    }
  }

  private session(sessionId: string): ActiveTerminal {
    const active = this.sessions.get(sessionId);
    if (!active) throw new WebTerminalError("Terminal session not found.", 404);
    return active;
  }
}
