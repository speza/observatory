#!/usr/bin/env bun

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HerdrHostAdapter } from "./hosts/herdr/adapter.ts";
import { SqliteUniverseStore } from "./persistence/sqlite/sqlite-store.ts";
import { createProjectionModule } from "./projection/projection.ts";
import { createCommandCentreRenderer } from "./renderer/tui.ts";
import { Universe } from "./universe/universe.ts";
import type { Clock, IdGenerator } from "./universe/types.ts";

class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

class RuntimeIds implements IdGenerator {
  private sequence = 0;

  next(kind: "goal" | "session"): string {
    this.sequence += 1;
    return `${kind}-${Date.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

const clock = new SystemClock();
const databasePath =
  process.env.AO_DB_PATH ?? `${process.cwd()}/data/ao.sqlite`;
if (databasePath !== ":memory:")
  mkdirSync(dirname(databasePath), { recursive: true });
const store = new SqliteUniverseStore(databasePath);
const host = new HerdrHostAdapter({ clock });
const universe = new Universe(
  store,
  clock,
  new RuntimeIds(),
  createProjectionModule(),
);

const reconcile = async (): Promise<string> => {
  const snapshot = await host.snapshot();
  const result = universe.reconcile(snapshot);
  if (!result.accepted)
    return result.error ?? "Herdr reconciliation rejected the snapshot.";
  if (!snapshot.available)
    return `Herdr unavailable · stored state retained${snapshot.error ? ` · ${snapshot.error}` : ""}`;
  return `Herdr refreshed · ${snapshot.sessions.length} sessions · ${result.addedSessionIds.length} new · ${result.staleSessionIds.length} stale`;
};

const initialMessage = await reconcile();
const app = await createCommandCentreRenderer({
  universe,
  host,
  clock,
  refresh: reconcile,
  initialAction: initialMessage,
  onClose: () => store.close?.(),
});
app.start();
