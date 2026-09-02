import { describe, expect, test } from "bun:test";
import { startSerializedRefreshLoop } from "./refresh-loop.ts";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("serialized refresh loop", () => {
  test("never overlaps a slow refresh and stops scheduling new work", async () => {
    let active = 0;
    let maximumActive = 0;
    let completed = 0;
    const loop = startSerializedRefreshLoop({
      intervalMs: 5,
      refresh: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await wait(15);
        active -= 1;
        completed += 1;
      },
      onError: () => undefined,
    });

    await wait(48);
    loop.stop();
    const completedAtStop = completed;
    await wait(25);

    expect(maximumActive).toBe(1);
    expect(completed).toBeGreaterThanOrEqual(2);
    expect(completed).toBeLessThanOrEqual(completedAtStop + 1);
  });

  test("reports failure and continues with the next serialized refresh", async () => {
    let attempts = 0;
    const errors: string[] = [];
    const loop = startSerializedRefreshLoop({
      intervalMs: 5,
      refresh: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("synthetic refresh failure");
      },
      onError: (error) => errors.push(error),
    });

    await wait(22);
    loop.stop();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(errors).toHaveLength(1);
  });
});
