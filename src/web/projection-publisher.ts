import type { ControlPlaneEvent, ControlPlaneEventSource } from "../control-plane-events/index.ts";
import type { PortfolioResponse } from "./portfolio.ts";
import type {
  BrowserProjectionEvent,
  BrowserProjectionSnapshot,
  RendererSubject,
  WebPendingLaunch,
} from "./protocol.ts";
import { isAllowedWebRequest } from "./security.ts";

const DEFAULT_BATCH_MS = 250;
const DEFAULT_TIME_REFRESH_MS = 30_000;
const MAX_SUBSCRIBERS = 32;
const MAX_AFFECTED_SUBJECTS = 500;
const MAX_SERIALIZED_EVENT_BYTES = 5 * 1024 * 1024;
const heartbeat = new TextEncoder().encode(": keepalive\n\n");
const textEncoder = new TextEncoder();

interface ProjectionSubscriber {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  pending?: Uint8Array;
  heartbeat?: ReturnType<typeof setInterval>;
}

export interface ProjectionPublisherOptions {
  readonly events: ControlPlaneEventSource;
  readonly projectPortfolio: () => PortfolioResponse;
  readonly pendingLaunches: () => readonly WebPendingLaunch[];
  readonly now: () => number;
  readonly allowedOrigin: string;
  readonly batchMs?: number;
  readonly timeRefreshMs?: number;
  readonly onError?: (message: string) => void;
}

const encoded = (event: BrowserProjectionEvent): Uint8Array => {
  const payload = textEncoder.encode(
    `event: ${event.kind}\nid: ${event.epoch}:${event.revision}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  if (payload.byteLength > MAX_SERIALIZED_EVENT_BYTES)
    throw new Error(
      `Projection event exceeded the ${MAX_SERIALIZED_EVENT_BYTES} byte delivery limit.`,
    );
  return payload;
};

const expandedSubjects = (
  directSubjects: readonly RendererSubject[],
  portfolios: readonly PortfolioResponse[],
): readonly RendererSubject[] => {
  const values = new Map(
    directSubjects.map((subject) => [`${subject.type}:${subject.id}`, subject]),
  );
  const add = (type: RendererSubject["type"], id: string): void => {
    values.set(`${type}:${id}`, { type, id });
  };
  const systems = portfolios.flatMap((portfolio) => portfolio.commandCentre.systems);
  const goals = portfolios.flatMap((portfolio) => [
    ...portfolio.commandCentre.goals,
    ...portfolio.commandCentre.systems.flatMap((system) => system.goals),
  ]);
  for (const subject of directSubjects) {
    if (subject.type !== "agent") continue;
    for (const goal of goals)
      if (goal.agents.some((agent) => agent.id === subject.id)) add("goal", goal.id);
  }
  const subjectsWithGoals = Array.from(values.values());
  for (const subject of subjectsWithGoals) {
    if (subject.type !== "goal") continue;
    for (const system of systems)
      if (system.goals.some((goal) => goal.id === subject.id)) add("system", system.id);
  }
  return [...values.values()].sort((left, right) =>
    `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
  );
};

export class ProjectionPublisher {
  private readonly epoch: string;
  private readonly subscribers = new Set<ProjectionSubscriber>();
  private readonly pendingSubjects = new Map<string, RendererSubject>();
  private readonly unsubscribe: () => void;
  private readonly batchMs: number;
  private readonly timeRefreshMs: number;
  private batchTimer?: ReturnType<typeof setTimeout>;
  private batchRetryScheduled = false;
  private timeTimer?: ReturnType<typeof setInterval>;
  private revision = 1;
  private portfolio: PortfolioResponse;
  private launches: readonly WebPendingLaunch[];
  private generatedAt: number;
  private pendingPortfolio = false;
  private pendingLaunches = false;
  private pendingAffectedAll = false;
  private closed = false;

  constructor(private readonly options: ProjectionPublisherOptions) {
    this.epoch = options.events.cursor().epoch;
    this.batchMs = Math.max(1, options.batchMs ?? DEFAULT_BATCH_MS);
    this.timeRefreshMs = Math.max(1_000, options.timeRefreshMs ?? DEFAULT_TIME_REFRESH_MS);
    this.generatedAt = options.now();
    this.portfolio = options.projectPortfolio();
    this.launches = options.pendingLaunches();
    this.unsubscribe = options.events.subscribe((events) => this.accept(events));
  }

  current(): BrowserProjectionSnapshot {
    return {
      kind: "snapshot",
      epoch: this.epoch,
      revision: this.revision,
      generatedAt: this.generatedAt,
      portfolio: this.portfolio,
      pendingLaunches: this.launches,
      affected: [],
      affectedAll: false,
    };
  }

  stream(request: Request): Response {
    if (!isAllowedWebRequest(request, this.options.allowedOrigin))
      return new Response("Request origin rejected.", { status: 403 });
    if (request.method !== "GET") return new Response("Method not allowed.", { status: 405 });
    if (this.closed) return new Response("Projection delivery is closed.", { status: 503 });
    if (this.subscribers.size >= MAX_SUBSCRIBERS)
      return new Response("Too many projection subscribers.", { status: 503 });
    let initial: Uint8Array;
    try {
      initial = encoded(this.current());
    } catch (error) {
      this.report(error instanceof Error ? error.message : "Snapshot encoding failed.");
      return new Response("Projection snapshot is too large to deliver.", { status: 503 });
    }

    let subscriber: ProjectionSubscriber | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = { controller };
        this.subscribers.add(subscriber);
        controller.enqueue(initial);
        subscriber.heartbeat = setInterval(() => {
          if (controller.desiredSize !== null && controller.desiredSize > 0)
            this.enqueue(subscriber!, heartbeat);
        }, 15_000);
        this.startTimeRefresh();
      },
      pull: () => {
        if (!subscriber?.pending) return;
        const pending = subscriber.pending;
        subscriber.pending = undefined;
        this.enqueue(subscriber, pending);
      },
      cancel: () => {
        if (subscriber) this.removeSubscriber(subscriber);
      },
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

  refreshTimeDerivedState(): void {
    if (this.closed) return;
    try {
      const portfolio = this.options.projectPortfolio();
      const generatedAt = this.options.now();
      const revision = this.revision + 1;
      const event: BrowserProjectionEvent = {
        kind: "portfolio-replaced",
        epoch: this.epoch,
        revision,
        generatedAt,
        portfolio,
        affected: [],
        affectedAll: false,
      };
      const payload = encoded(event);
      this.portfolio = portfolio;
      this.generatedAt = generatedAt;
      this.revision = revision;
      this.broadcast(payload);
    } catch (error) {
      this.report(error instanceof Error ? error.message : "Projection refresh failed.");
      this.disconnectSubscribers();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.timeTimer) clearInterval(this.timeTimer);
    this.disconnectSubscribers();
  }

  private accept(events: readonly ControlPlaneEvent[]): void {
    if (this.closed || events.length === 0) return;
    for (const event of events) {
      if (event.type !== "pending-launch-changed") this.pendingPortfolio = true;
      if (
        event.type === "pending-launch-changed" ||
        event.type === "agent-changed" ||
        event.type === "execution-evidence-changed"
      )
        this.pendingLaunches = true;
      if (event.type === "system-changed") this.addSubjects("system", event.systemIds);
      else if (event.type === "goal-changed") this.addSubjects("goal", event.goalIds);
      else if (
        event.type === "agent-changed" ||
        event.type === "execution-evidence-changed" ||
        event.type === "provider-evidence-changed"
      )
        this.addSubjects("agent", event.agentIds);
    }
    this.scheduleBatch(this.batchMs);
  }

  private addSubjects(type: RendererSubject["type"], ids: readonly string[]): void {
    if (this.pendingAffectedAll) return;
    for (const id of ids) {
      const key = `${type}:${id}`;
      if (this.pendingSubjects.has(key)) continue;
      if (this.pendingSubjects.size >= MAX_AFFECTED_SUBJECTS) {
        this.pendingAffectedAll = true;
        this.pendingSubjects.clear();
        return;
      }
      this.pendingSubjects.set(key, { type, id });
    }
  }

  private scheduleBatch(delay: number, retry = false): void {
    if (this.batchTimer) {
      if (this.batchRetryScheduled && !retry) {
        clearTimeout(this.batchTimer);
        this.batchTimer = undefined;
      } else {
        return;
      }
    }
    this.batchRetryScheduled = retry;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      this.batchRetryScheduled = false;
      this.flush();
    }, delay);
  }

  private flush(): void {
    if ((!this.pendingPortfolio && !this.pendingLaunches) || this.closed) return;
    const portfolioChanged = this.pendingPortfolio;
    const launchesChanged = this.pendingLaunches;
    const previousPortfolio = this.portfolio;
    try {
      const portfolio = portfolioChanged ? this.options.projectPortfolio() : this.portfolio;
      const launches = launchesChanged ? this.options.pendingLaunches() : this.launches;
      const generatedAt = this.options.now();
      const revision = this.revision + 1;
      let affectedAll = this.pendingAffectedAll;
      let affected = affectedAll
        ? []
        : expandedSubjects([...this.pendingSubjects.values()], [previousPortfolio, portfolio]);
      if (affected.length > MAX_AFFECTED_SUBJECTS) {
        affectedAll = true;
        affected = [];
      }
      const common = { epoch: this.epoch, revision, generatedAt, affected, affectedAll };
      const event: BrowserProjectionEvent =
        portfolioChanged && launchesChanged
          ? { kind: "snapshot", ...common, portfolio, pendingLaunches: launches }
          : portfolioChanged
            ? { kind: "portfolio-replaced", ...common, portfolio }
            : { kind: "pending-launches-replaced", ...common, pendingLaunches: launches };
      const payload = encoded(event);
      this.portfolio = portfolio;
      this.launches = launches;
      this.generatedAt = generatedAt;
      this.revision = revision;
      this.pendingPortfolio = false;
      this.pendingLaunches = false;
      this.pendingAffectedAll = false;
      this.pendingSubjects.clear();
      this.broadcast(payload);
    } catch (error) {
      this.report(error instanceof Error ? error.message : "Projection batch failed.");
      this.disconnectSubscribers();
      this.scheduleBatch(this.timeRefreshMs, true);
    }
  }

  private broadcast(payload: Uint8Array): void {
    let replacement: Uint8Array | undefined;
    for (const subscriber of this.subscribers) {
      if (subscriber.controller.desiredSize !== null && subscriber.controller.desiredSize > 0) {
        this.enqueue(subscriber, payload);
      } else {
        try {
          replacement ??= encoded(this.current());
          subscriber.pending = replacement;
        } catch (error) {
          this.report(error instanceof Error ? error.message : "Snapshot encoding failed.");
          this.removeSubscriber(subscriber);
        }
      }
    }
  }

  private enqueue(subscriber: ProjectionSubscriber, payload: Uint8Array): void {
    try {
      subscriber.controller.enqueue(payload);
    } catch {
      this.removeSubscriber(subscriber);
    }
  }

  private disconnectSubscribers(): void {
    for (const subscriber of this.subscribers) {
      this.removeSubscriber(subscriber);
      try {
        subscriber.controller.close();
      } catch {
        // The browser may already have closed the stream.
      }
    }
  }

  private removeSubscriber(subscriber: ProjectionSubscriber): void {
    this.subscribers.delete(subscriber);
    if (subscriber.heartbeat) clearInterval(subscriber.heartbeat);
    subscriber.pending = undefined;
    if (this.subscribers.size === 0 && this.timeTimer) {
      clearInterval(this.timeTimer);
      this.timeTimer = undefined;
    }
  }

  private startTimeRefresh(): void {
    if (this.timeTimer) return;
    this.timeTimer = setInterval(() => this.refreshTimeDerivedState(), this.timeRefreshMs);
  }

  private report(message: string): void {
    try {
      this.options.onError?.(`Projection publication failed: ${message}`);
    } catch {
      // Diagnostics cannot make projection delivery fail less safely.
    }
  }
}
