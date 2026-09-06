import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireDatabaseOwnership, DatabaseOwnershipError } from "./database-ownership.ts";

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

const databasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "ao-owner-"));
  directories.push(directory);
  return join(directory, "ao.sqlite");
};

describe("database ownership", () => {
  test("excludes another owner and can be reacquired after release", () => {
    const path = databasePath();
    const first = acquireDatabaseOwnership(path);
    expect(() => acquireDatabaseOwnership(path)).toThrow(DatabaseOwnershipError);
    first.release();
    const second = acquireDatabaseOwnership(path);
    second.release();
  });

  test("recovers automatically after the owning process exits", async () => {
    const path = databasePath();
    const child = Bun.spawn([
      process.execPath,
      "-e",
      `import { acquireDatabaseOwnership } from ${JSON.stringify(import.meta.dir + "/database-ownership.ts")}; acquireDatabaseOwnership(${JSON.stringify(path)});`,
    ]);
    expect(await child.exited).toBe(0);
    const owner = acquireDatabaseOwnership(path);
    owner.release();
  });
});
