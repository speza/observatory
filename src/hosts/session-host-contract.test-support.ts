import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { SessionHost } from "./types.ts";

export interface SessionHostContractHarness {
  readonly host: SessionHost;
  readonly agent: {
    readonly hostKind: string;
    readonly nativeId: string;
  };
}

type HarnessFactory =
  | (() => SessionHostContractHarness)
  | (() => Promise<SessionHostContractHarness>);

/**
 * Run the minimum capability contract against every production SessionHost.
 * Provider-specific assertions belong beside the adapter; this suite protects
 * the seam that the Universe and renderer actually consume.
 */
export const defineSessionHostContractTests = (
  label: string,
  createHarness: HarnessFactory,
): void => {
  describe(`${label} SessionHost contract`, () => {
    test("observes an available agent and returns supported access", async () => {
      const { host, agent } = await createHarness();
      const snapshot = await Effect.runPromise(host.snapshot());
      expect(snapshot.available).toBe(true);
      expect(snapshot.agents.some((candidate) => candidate.nativeId === agent.nativeId)).toBe(true);

      const access = await Effect.runPromise(host.access(agent));
      expect(access.supported).toBe(true);
      expect(access.explanation.length).toBeGreaterThan(0);
    });

    test("supports the primary terminal lifecycle", async () => {
      const { host, agent } = await createHarness();
      await Effect.runPromise(host.snapshot());
      const access = await Effect.runPromise(host.access(agent));
      expect(access.capabilities).toContain("embedded-terminal");

      const opened = await Effect.runPromise(host.openTerminal(access, { columns: 80, rows: 24 }));
      expect(opened.ok).toBe(true);
      expect(opened.terminal).toBeDefined();
      expect(
        await Effect.runPromise(opened.terminal!.send({ kind: "text", value: "contract" })),
      ).toMatchObject({ ok: true });
      expect(
        await Effect.runPromise(opened.terminal!.resize({ columns: 90, rows: 30 })),
      ).toMatchObject({ ok: true });
      expect(await Effect.runPromise(opened.terminal!.release())).toMatchObject({ ok: true });
    });

    test("supports native handoff through the same access capability", async () => {
      const { host, agent } = await createHarness();
      await Effect.runPromise(host.snapshot());
      const access = await Effect.runPromise(host.access(agent));
      expect(access.capabilities).toContain("native-handoff");
      expect(await Effect.runPromise(host.activate(access))).toMatchObject({ ok: true });
    });

    test("supports one available linked execution lifecycle", async () => {
      const { host, agent } = await createHarness();
      await Effect.runPromise(host.snapshot());
      const access = await Effect.runPromise(host.access(agent));
      const linkedExecution = access.linkedExecutions.find((candidate) => candidate.available);
      expect(linkedExecution).toBeDefined();
      expect(access.capabilities).toContain("linked-terminal");

      const opened = await Effect.runPromise(
        host.openLinkedExecutionTerminal(linkedExecution!, { columns: 60, rows: 18 }),
      );
      expect(opened.ok).toBe(true);
      expect(opened.terminal).toBeDefined();
      expect(await Effect.runPromise(opened.terminal!.release())).toMatchObject({ ok: true });
    });

    test("returns a structured launch result", async () => {
      const { host } = await createHarness();
      const launched = await Effect.runPromise(
        host.launch({
          requestId: `contract-${label.toLocaleLowerCase()}`,
          workingDirectory: "/sandbox/alpha",
          agentKind: "codex",
        }),
      );
      expect(launched).toMatchObject({ ok: expect.any(Boolean) });
      expect(launched.message.length).toBeGreaterThan(0);
    });
  });
};
