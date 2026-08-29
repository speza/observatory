#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SqliteUniverseStore } from "../src/persistence/sqlite/sqlite-store.ts";

const cliArguments = process.argv.slice(2);
const fullReset = cliArguments.includes("--all");
const unknownArguments = cliArguments.filter((argument) => argument !== "--all");
if (unknownArguments.length > 0)
  throw new Error(`Unknown reset argument: ${unknownArguments.join(", ")}`);

const configuredPath = process.env.AO_DB_PATH?.trim() || "data/ao.sqlite";
if (configuredPath === ":memory:") throw new Error("An in-memory database cannot be reset.");
const databasePath = resolve(configuredPath);
if (!existsSync(databasePath))
  throw new Error(`Observatory database does not exist: ${databasePath}`);

const backupSuffix = new Date().toISOString().replaceAll(/[-:.]/gu, "");
const backupPath = `${databasePath}.backup-${backupSuffix}`;
const store = new SqliteUniverseStore(databasePath);
try {
  store.backupTo(backupPath);
  const summary = fullReset ? store.resetAllState() : store.resetSemanticState();
  console.log(
    JSON.stringify(
      {
        mode: fullReset ? "all" : "semantics",
        databasePath,
        backupPath,
        ...summary,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
