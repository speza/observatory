import { createProjectionModule } from "../projection/projection.ts";
import type { HostSnapshot } from "../hosts/types.ts";
import { Universe } from "./universe.ts";
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
  private goal = 0;
  private agent = 0;
  next(kind: "goal" | "agent"): string {
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
}): UniverseFixture<TStore> => {
  // SAFETY: The fallback is only used when no caller-owned store is supplied;
  // otherwise the generic store is exactly the value passed in options.store.
  const store = (options?.store ?? new MemoryStore(options?.state)) as TStore;
  const clock = options?.clock ?? new FixedClock(1_000_000);
  return {
    universe: new Universe(store, clock, new SequenceIds(), createProjectionModule()),
    store,
    clock,
  };
};

export const hostSnapshot = (
  agents: HostSnapshot["agents"],
  observedAt = 1_000_000,
): HostSnapshot => ({
  hostKind: "test-host",
  available: true,
  observedAt,
  agents,
  diagnostics: [],
});
