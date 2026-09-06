import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const root = resolve(import.meta.dir, "..");
const developing = process.argv.includes("--dev");
if (developing) process.env.AO_DESKTOP_DEV = "1";
const vite = developing
  ? await createServer({ configFile: resolve(root, "web/vite.config.ts") })
  : undefined;
await vite?.listen();
const electronDirectory = join(root, "node_modules/electron");
const executable = join(
  electronDirectory,
  "dist",
  readFileSync(join(electronDirectory, "path.txt"), "utf8").trim(),
);
const child = Bun.spawn([executable, ".desktop/main.cjs", ...process.argv.slice(2)], {
  cwd: root,
  env: {
    ...process.env,
    AO_BUN_EXECUTABLE: process.execPath,
    AO_DESKTOP_DEV: developing ? "1" : "0",
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.exitCode = await child.exited;
await vite?.close();
