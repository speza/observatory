#!/usr/bin/env bun

import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
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
const database = new Database(databasePath);
const hasSchemaTable = Boolean(
  database
    .query<{ found: number }, []>(
      "SELECT COUNT(*) AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .get()?.found,
);
const currentSchema =
  hasSchemaTable &&
  Boolean(
    database
      .query<{ found: number }, []>(
        "SELECT COUNT(*) AS found FROM schema_migrations WHERE version = 12",
      )
      .get()?.found,
  );

if (!currentSchema && !fullReset) {
  database.close();
  throw new Error(
    "This database predates conversation-first tracking. Use `bun run db:reset:all` to back it up and replace it.",
  );
}

database.prepare("VACUUM INTO ?").run(backupPath);
database.close();

if (!currentSchema) {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`])
    if (existsSync(path)) unlinkSync(path);
  const fresh = new SqliteUniverseStore(databasePath);
  fresh.close();
  console.log(
    JSON.stringify(
      {
        mode: "all",
        databasePath,
        backupPath,
        replacedLegacySchema: true,
      },
      null,
      2,
    ),
  );
} else {
  const store = new SqliteUniverseStore(databasePath);
  try {
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
}
