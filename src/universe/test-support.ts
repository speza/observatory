import type { ControlPlaneEventSink } from "../control-plane-events/index.ts";
import { createProjectionModule } from "../projection/projection.ts";
import type { HostSnapshot } from "../hosts/types.ts";
import { Universe, type ReconciliationResult } from "./universe.ts";
import {
  emptyUniverseState,
  type Clock,
  type IdGenerator,
  type UniverseState,
  type UniverseStore,
} from "./types.ts";

export class FixedClock implements Clock {
  constructor(public value: number) {}
  now(): number {
    return this.value;
  }
}

export class SequenceIds implements IdGenerator {
  private system = 0;
  private goal = 0;
  private agent = 0;
  next(kind: "system" | "goal" | "agent"): string {
    if (kind === "system") return `system-${++this.system}`;
    if (kind === "goal") return `goal-${++this.goal}`;
    return `agent-${++this.agent}`;
  }
}

export class MemoryStore implements UniverseStore {
  state: UniverseState;
  saves = 0;
  failNextSave = false;

  constructor(state: UniverseState = emptyUniverseState()) {
    this.state = state;
  }

  load(): UniverseState {
    return structuredClone(this.state);
  }

  save(state: UniverseState): void {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("injected persistence failure");
    }
    this.state = structuredClone(state);
    this.saves += 1;
  }
}

interface UniverseFixture<TStore extends UniverseStore> {
  readonly universe: Universe;
  readonly store: TStore;
  readonly clock: FixedClock;
}

export const makeUniverse = <TStore extends UniverseStore = MemoryStore>(options?: {
  readonly state?: UniverseState;
  readonly clock?: FixedClock;
  readonly store?: TStore;
  readonly events?: ControlPlaneEventSink;
}): UniverseFixture<TStore> => {
  // SAFETY: The fallback is only used when no caller-owned store is supplied;
  // otherwise the generic store is exactly the value passed in options.store.
  const store = (options?.store ?? new MemoryStore(options?.state)) as TStore;
  const clock = options?.clock ?? new FixedClock(1_000_000);
  return {
    universe: new Universe(
      store,
      clock,
      new SequenceIds(),
      createProjectionModule(),
      options?.events,
    ),
    store,
    clock,
  };
};

export const admitObservedConversationsAndReconcile = (
  universe: Universe,
  snapshot: HostSnapshot,
): ReconciliationResult => {
  for (const observation of snapshot.agents) {
    const reference = observation.harnessEvidence?.nativeConversationRef;
    if (!reference) continue;
    const result = universe.execute({
      type: "AddConversation",
      admissionSource: "managed-launch",
      harnessId: reference.harnessId,
      nativeConversationRef: reference,
      displayName: observation.displayName,
      workspaceRef: observation.worktree,
      observedAt: observation.observedAt,
    });
    if (!result.ok)
      throw new Error(result.error ?? "Test conversation could not be explicitly admitted.");
  }
  return universe.reconcile(snapshot);
};

export const hostSnapshot = (
  agents: HostSnapshot["agents"],
  observedAt = 1_000_000,
): HostSnapshot => ({
  hostKind: "test-host",
  hostInstanceId: "test-host:default",
  available: true,
  complete: true,
  observedAt,
  agents: agents.map((agent) =>
    agent.harnessEvidence
      ? agent
      : {
          ...agent,
          harnessEvidence: {
            detectedHarnessId: "test-harness",
            nativeConversationRef: {
              harnessId: "test-harness",
              continuityScopeId: "test-scope",
              kind: "conversation-id",
              value: agent.nativeId.trim(),
            },
            restoreState: "not-restored",
            source: "native-integration",
            observedAt: agent.observedAt,
          },
        },
  ),
  diagnostics: [],
});
