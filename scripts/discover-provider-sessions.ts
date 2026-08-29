#!/usr/bin/env bun

import { Effect, Either } from "effect";
import { resolve } from "node:path";
import { loadPluginRegistry } from "../src/plugins/registry.ts";

const registry = await Effect.runPromise(
  loadPluginRegistry({
    packages: [{ path: resolve(import.meta.dir, "../plugins/agent-harnesses") }],
  }),
);

try {
  const results = await Effect.runPromise(
    Effect.forEach(
      registry.agentHarnesses(),
      (harness) =>
        Effect.map(Effect.either(harness.snapshotSessions()), (result) => ({ harness, result })),
      { concurrency: "unbounded" },
    ),
  );
  for (const { harness, result } of results) {
    if (Either.isLeft(result)) {
      console.log(`${harness.describe().label}: unavailable (${result.left.message})`);
      continue;
    }
    console.log(
      `${harness.describe().label}: ${result.right.sessions.length} sessions (${result.right.complete ? "complete" : "partial"} snapshot)`,
    );
    for (const session of result.right.sessions.slice(0, 20))
      console.log(
        `  ${session.lastActiveAt ? new Date(session.lastActiveAt).toISOString() : "unknown time"} · ${session.title ?? "untitled"} · ${session.workspaceRef ?? "workspace unknown"} · ${session.resumeEligibility}`,
      );
    if (result.right.sessions.length > 20)
      console.log(`  … ${result.right.sessions.length - 20} more`);
    for (const diagnostic of result.right.diagnostics) console.log(`  warning: ${diagnostic}`);
  }
} finally {
  await Effect.runPromise(registry.close());
}
