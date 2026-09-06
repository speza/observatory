import { cp, mkdir, rm, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { packager } from "@electron/packager";
import manifest from "../package.json";

const root = resolve(import.meta.dir, "..");
const output = join(root, ".desktop");
await mkdir(output, { recursive: true });
const main = await Bun.build({
  entrypoints: [join(root, "desktop/main.ts")],
  target: "node",
  format: "cjs",
  external: ["electron"],
  outdir: output,
  naming: "main.cjs",
});
if (!main.success) throw new AggregateError(main.logs, "Desktop main build failed.");
if (process.argv.includes("--package")) {
  const stage = join(output, "stage");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(join(output, "main.cjs"), join(stage, "main.cjs"));
  await cp(join(root, "web/dist"), join(stage, "web/dist"), { recursive: true });
  await cp(join(root, "LICENSE"), join(stage, "LICENSE"));
  // Backend and dynamically loaded built-in plugins retain their existing source layout.
  await cp(join(root, "src"), join(stage, "src"), { recursive: true });
  await cp(join(root, "plugins"), join(stage, "plugins"), { recursive: true });
  await Bun.write(
    join(stage, "package.json"),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      main: "main.cjs",
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    }),
  );
  await cp(join(root, "bun.lock"), join(stage, "bun.lock"));
  const install = Bun.spawn(
    [process.execPath, "install", "--production", "--ignore-scripts", "--frozen-lockfile"],
    {
      cwd: stage,
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await install.exited) !== 0) throw new Error("Packaged dependency installation failed.");
  await mkdir(join(stage, "runtime"));
  await cp(process.execPath, join(stage, "runtime/bun"));
  await chmod(join(stage, "runtime/bun"), 0o755);
  await Bun.write(
    join(stage, "runtime/build.json"),
    JSON.stringify({
      bun: Bun.version,
      electron: manifest.devDependencies.electron,
      platform: process.platform,
      arch: process.arch,
    }),
  );
  const paths = await packager({
    dir: stage,
    out: join(output, "release"),
    name: "Observatory",
    executableName: "observatory",
    appBundleId: "dev.observatory.desktop",
    electronVersion: manifest.devDependencies.electron,
    overwrite: true,
    asar: false,
    prune: false,
  });
  console.log(paths.join("\n"));
}
