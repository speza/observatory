import { randomUUID } from "node:crypto";
import type { AgentObservationKind } from "../plugin-sdk/index.ts";
import type { AgentId, GoalId, SystemId } from "../universe/types.ts";

const MAX_EVENT_IDS = 500;

export type ControlPlaneEventCause =
  | "human-command"
  | "host-observation"
  | "provider-catalogue"
  | "provider-observation"
  | "launch-operation";

interface ControlPlaneEventBase {
  readonly occurredAt: number;
  readonly cause: ControlPlaneEventCause;
}

export type UnsequencedControlPlaneEvent =
  | (ControlPlaneEventBase & {
      readonly type: "system-changed";
      readonly systemIds: readonly SystemId[];
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "goal-changed";
      readonly goalIds: readonly GoalId[];
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "agent-changed";
      readonly agentIds: readonly AgentId[];
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "catch-up-changed";
      readonly semanticSequence?: number;
    })
  | (ControlPlaneEventBase & {
      readonly type: "execution-evidence-changed";
      readonly agentIds: readonly AgentId[];
      readonly hostInstanceIds: readonly string[];
      readonly availabilityChanged: boolean;
    })
  | (ControlPlaneEventBase & {
      readonly type: "provider-evidence-changed";
      readonly agentIds: readonly AgentId[];
      readonly kinds: readonly AgentObservationKind[];
    })
  | (ControlPlaneEventBase & {
      readonly type: "pending-launch-changed";
      readonly requestIds: readonly string[];
    });

export type ControlPlaneEvent = UnsequencedControlPlaneEvent & {
  readonly epoch: string;
  readonly sequence: number;
};

export interface ControlPlaneEventSink {
  publish(events: readonly UnsequencedControlPlaneEvent[]): void;
}

export interface ControlPlaneEventCursor {
  readonly epoch: string;
  readonly sequence: number;
}

export interface ControlPlaneEventSource {
  cursor(): ControlPlaneEventCursor;
  subscribe(listener: (events: readonly ControlPlaneEvent[]) => void): () => void;
}

type Listener = (events: readonly ControlPlaneEvent[]) => void;

const normalizedIdChunks = (values: readonly string[]): readonly (readonly string[])[] => {
  const normalized = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  const chunks: string[][] = [];
  for (let offset = 0; offset < normalized.length; offset += MAX_EVENT_IDS)
    chunks.push(normalized.slice(offset, offset + MAX_EVENT_IDS));
  return chunks;
};

const normalizeEvent = (
  event: UnsequencedControlPlaneEvent,
): readonly UnsequencedControlPlaneEvent[] => {
  if (!Number.isFinite(event.occurredAt)) return [];
  switch (event.type) {
    case "system-changed":
      return normalizedIdChunks(event.systemIds).map((systemIds) => ({ ...event, systemIds }));
    case "goal-changed":
      return normalizedIdChunks(event.goalIds).map((goalIds) => ({ ...event, goalIds }));
    case "agent-changed":
      return normalizedIdChunks(event.agentIds).map((agentIds) => ({ ...event, agentIds }));
    case "execution-evidence-changed":
      return [
        ...normalizedIdChunks(event.agentIds).map((agentIds) => ({
          ...event,
          agentIds,
          hostInstanceIds: [],
        })),
        ...normalizedIdChunks(event.hostInstanceIds).map((hostInstanceIds) => ({
          ...event,
          agentIds: [],
          hostInstanceIds,
        })),
      ];
    case "provider-evidence-changed": {
      const kinds = [...new Set(event.kinds)].sort();
      return kinds.length > 0
        ? normalizedIdChunks(event.agentIds).map((agentIds) => ({ ...event, agentIds, kinds }))
        : [];
    }
    case "pending-launch-changed":
      return normalizedIdChunks(event.requestIds).map((requestIds) => ({ ...event, requestIds }));
    case "catch-up-changed":
      return [event];
  }
};

export class ControlPlaneEventHub implements ControlPlaneEventSink, ControlPlaneEventSource {
  private readonly epoch = randomUUID();
  private readonly listeners = new Set<Listener>();
  private readonly queued: UnsequencedControlPlaneEvent[][] = [];
  private sequence = 0;
  private publishing = false;

  cursor(): ControlPlaneEventCursor {
    return { epoch: this.epoch, sequence: this.sequence };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(events: readonly UnsequencedControlPlaneEvent[]): void {
    const normalized = events.flatMap(normalizeEvent);
    if (normalized.length === 0) return;
    this.queued.push(normalized);
    if (this.publishing) return;
    this.publishing = true;
    try {
      let batch: UnsequencedControlPlaneEvent[] | undefined;
      while ((batch = this.queued.shift())) {
        const sequenced = batch.map((event): ControlPlaneEvent => ({
          ...event,
          epoch: this.epoch,
          sequence: ++this.sequence,
        }));
        for (const listener of this.listeners) {
          try {
            listener(sequenced);
          } catch {
            // A notification cannot roll back committed state or block another listener.
          }
        }
      }
    } finally {
      this.publishing = false;
    }
  }
}
