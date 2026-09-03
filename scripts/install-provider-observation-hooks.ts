import { Schema } from "effect";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  defaultProviderRoot,
  observationInstallManifest,
  observationInstallRoot,
  providerSettingsPath,
  validObservationEndpoint,
  type ProviderHarnessId,
  type ProviderObservationInstallManifest,
} from "../plugins/agent-harnesses/provider-observation-installation.ts";
import {
  DEFAULT_PROVIDER_OBSERVATION_ENDPOINT,
  defaultProviderObservationTokenPath,
  validProviderObservationToken,
} from "../src/agent-observations/ingress.ts";

type JsonValue = string | number | boolean | null | JsonValue[] | MutableJson;
interface MutableJson {
  [key: string]: JsonValue;
}
const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  ),
);
const JsonObjectSchema: Schema.Schema<MutableJson> = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema,
});
const ErrorCodeSchema = Schema.Struct({ code: Schema.String });

const objectValue = (value: JsonValue | undefined): MutableJson =>
  Schema.is(JsonObjectSchema)(value) ? value : {};

const readSettings = async (path: string): Promise<MutableJson> => {
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(JsonObjectSchema))(
      await readFile(path, "utf8"),
    );
  } catch (error) {
    if (Schema.is(ErrorCodeSchema)(error) && error.code === "ENOENT") return {};
    throw error;
  }
};

const writeSettings = async (path: string, settings: MutableJson): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.observatory-${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'"'"'`)}'`;

const commandFor = (
  executable: string,
  harnessId: "claude" | "codex",
  endpoint: string,
  tokenFile: string,
): string =>
  [
    shellQuote(process.execPath),
    shellQuote(executable),
    harnessId,
    "--endpoint",
    shellQuote(endpoint),
    "--token-file",
    shellQuote(tokenFile),
  ].join(" ");

const hookEvents = {
  claude: [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "PreCompact",
    "PostCompact",
    "SessionEnd",
  ],
  codex: [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "Stop",
    "PreCompact",
    "PostCompact",
    "SessionEnd",
  ],
} as const;

const installCommandHooks = async (
  path: string,
  harnessId: "claude" | "codex",
  command: string,
): Promise<void> => {
  const settings = await readSettings(path);
  const hooks = objectValue(settings.hooks);
  settings.hooks = hooks;
  for (const event of hookEvents[harnessId]) {
    const groups = (Array.isArray(hooks[event]) ? hooks[event] : []).filter(
      (group) => !JSON.stringify(group).includes("provider-observation-hook"),
    );
    if (!JSON.stringify(groups).includes(command))
      groups.push({
        hooks: [
          {
            type: "command",
            command,
            async: false,
            timeout: harnessId === "codex" && event === "SessionEnd" ? 3 : 10,
          },
        ],
      });
    hooks[event] = groups;
  }
  await writeSettings(path, settings);
};

const installPiExtension = async (path: string, extension: string): Promise<void> => {
  const settings = await readSettings(path);
  const extensions = Array.isArray(settings.extensions)
    ? settings.extensions
        .filter(Schema.is(Schema.String))
        .filter((value) => !value.includes("pi-observation-extension"))
    : [];
  if (!extensions.includes(extension)) extensions.push(extension);
  settings.extensions = extensions;
  await writeSettings(path, settings);
};

const ensureToken = async (path: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!Schema.is(ErrorCodeSchema)(error) || error.code !== "EEXIST") throw error;
  }
  await chmod(path, 0o600);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 256)
    throw new Error("The existing observation delivery token is invalid.");
  const token = (await readFile(path, "utf8")).trim();
  if (!validProviderObservationToken(token))
    throw new Error("The existing observation delivery token is invalid.");
};

const buildInstalledHooks = async (
  installRoot: string,
  endpoint: string,
  tokenFile: string,
): Promise<{
  readonly buildId: string;
  readonly commandHook: string;
  readonly piExtension: string;
}> => {
  await mkdir(installRoot, { recursive: true });
  const directory = await mkdtemp(join(installRoot, ".staging-"));
  const commandResult = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "provider-observation-hook.ts")],
    outdir: directory,
    naming: "provider-observation-hook.js",
    target: "bun",
    format: "esm",
    minify: true,
  });
  if (!commandResult.success) throw new Error("The provider observation hook could not be built.");

  const wrapper = join(directory, `.pi-observation-extension-${process.pid}.ts`);
  const piSource = resolve(
    import.meta.dir,
    "../plugins/agent-harnesses/pi-observation-extension.ts",
  );
  await writeFile(
    wrapper,
    `import { createPiObservationExtension } from ${JSON.stringify(piSource)};\nexport default createPiObservationExtension(${JSON.stringify({ endpoint, tokenFile })});\n`,
    { mode: 0o600 },
  );
  try {
    const piResult = await Bun.build({
      entrypoints: [wrapper],
      outdir: directory,
      naming: "pi-observation-extension.js",
      target: "node",
      format: "esm",
      minify: true,
    });
    if (!piResult.success) throw new Error("The Pi observation extension could not be built.");
  } finally {
    await unlink(wrapper).catch(() => undefined);
  }
  const stagedCommandHook = join(directory, "provider-observation-hook.js");
  const stagedPiExtension = join(directory, "pi-observation-extension.js");
  await Promise.all([chmod(stagedCommandHook, 0o600), chmod(stagedPiExtension, 0o600)]);
  const buildId = createHash("sha256")
    .update(await readFile(stagedCommandHook))
    .update(await readFile(stagedPiExtension))
    .digest("hex")
    .slice(0, 16);
  const published = join(installRoot, `build-${buildId}`);
  try {
    await rename(directory, published);
  } catch (error) {
    if (!Schema.is(ErrorCodeSchema)(error) || !["EEXIST", "ENOTEMPTY"].includes(error.code))
      throw error;
    await rm(directory, { recursive: true, force: true });
  }
  return {
    buildId,
    commandHook: join(published, "provider-observation-hook.js"),
    piExtension: join(published, "pi-observation-extension.js"),
  };
};

const stringArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  return index >= 0 && value ? value : undefined;
};

const pathArgument = (name: string): string | undefined => {
  const value = stringArgument(name);
  return value ? resolve(value) : undefined;
};

const homeArgument = process.argv.indexOf("--home");
const targetHome =
  homeArgument >= 0 && process.argv[homeArgument + 1]
    ? resolve(process.argv[homeArgument + 1])
    : process.env.HOME;
if (!targetHome) throw new Error("A home directory is required.");

const roots = {
  claude: pathArgument("--claude-root") ?? defaultProviderRoot("claude", targetHome),
  codex: pathArgument("--codex-root") ?? defaultProviderRoot("codex", targetHome),
  pi: pathArgument("--pi-root") ?? defaultProviderRoot("pi", targetHome),
} satisfies Record<ProviderHarnessId, string>;
const endpoint = stringArgument("--endpoint") ?? DEFAULT_PROVIDER_OBSERVATION_ENDPOINT;
if (!validObservationEndpoint(endpoint))
  throw new Error("The observation endpoint must be the loopback Observatory ingress URL.");
const tokenFile = pathArgument("--token-file") ?? defaultProviderObservationTokenPath(targetHome);
await ensureToken(tokenFile);
const installed = await buildInstalledHooks(
  observationInstallRoot(targetHome),
  endpoint,
  tokenFile,
);

await installCommandHooks(
  providerSettingsPath("claude", targetHome),
  "claude",
  commandFor(installed.commandHook, "claude", endpoint, tokenFile),
);
await installCommandHooks(
  providerSettingsPath("codex", targetHome),
  "codex",
  commandFor(installed.commandHook, "codex", endpoint, tokenFile),
);
await installPiExtension(providerSettingsPath("pi", targetHome), installed.piExtension);

const manifest: ProviderObservationInstallManifest = {
  schemaVersion: 2,
  installedAt: Date.now(),
  buildId: installed.buildId,
  commandHook: installed.commandHook,
  piExtension: installed.piExtension,
  endpoint,
  tokenFile,
  providers: {
    claude: { root: roots.claude },
    codex: { root: roots.codex },
    pi: { root: roots.pi },
  },
};
await writeSettings(observationInstallManifest(targetHome), manifest);

console.log("Installed Observatory observation hooks for Claude Code, Codex and Pi.");
