import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export class DatabaseOwnershipError extends Error {
  constructor(readonly databasePath: string) {
    super(`Observatory database is already owned by another process: ${databasePath}`);
    this.name = "DatabaseOwnershipError";
  }
}

export interface DatabaseOwnership {
  readonly databasePath: string;
  release(): void;
}

/** A separate SQLite file holds an OS-backed exclusive lock for the process lifetime.
 * Never unlink it: all contenders must lock the same inode. Process death releases
 * the lock without PID guessing or racing to remove a stale ownership record.
 */
export const acquireDatabaseOwnership = (databasePath: string): DatabaseOwnership => {
  if (databasePath === ":memory:") return { databasePath, release: () => undefined };
  const absolutePath = resolve(databasePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const canonicalPath = existsSync(absolutePath)
    ? realpathSync(absolutePath)
    : join(realpathSync(dirname(absolutePath)), basename(absolutePath));
  const lock = new Database(`${canonicalPath}.ownership.sqlite`, { create: true });
  try {
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new DatabaseOwnershipError(canonicalPath);
  }
  let released = false;
  return {
    databasePath: canonicalPath,
    release: () => {
      if (released) return;
      released = true;
      lock.close();
    },
  };
};
