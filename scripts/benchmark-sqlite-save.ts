import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteUniverseStore } from "../src/persistence/sqlite/sqlite-store.ts";
import type { UniverseState } from "../src/universe/types.ts";

// Synthetic, file-backed store cost, not live terminal latency. Seed outside the
// measurement, then report the median of five identical saves and total_changes
// deltas (no triggers). Run with: bun run scripts/benchmark-sqlite-save.ts
const directory = mkdtempSync(join(tmpdir(), "ao-save-benchmark-"));
try {
  for (const history of [0, 10_000, 100_000]) {
    const store = new SqliteUniverseStore(join(directory, `${history}.sqlite`));
    try {
      const state: UniverseState = {
        version: 1,
        systems: [],
        goals: [
          {
            id: "goal",
            title: "Synthetic",
            priority: "P2",
            status: "active",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        agents: [],
        hosts: [],
        relatedAgentDismissals: [],
        changes: Array.from({ length: history }, (_, index) => ({
          sequence: index + 1,
          occurredAt: index + 1,
          outcome: "changed",
          targetType: "goal",
          targetId: "goal",
          summary: "Synthetic event",
        })),
      };
      const count = () => store.db.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
      store.save(state);
      const samples = Array.from({ length: 5 }, () => {
        const before = count();
        const start = performance.now();
        store.save(state);
        const ms = performance.now() - start;
        return { ms, mutations: count() - before };
      });
      console.log(
        JSON.stringify({
          history,
          medianMs: samples.map((sample) => sample.ms).sort((a, b) => a - b)[2],
          samples,
        }),
      );
    } finally {
      store.close();
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
