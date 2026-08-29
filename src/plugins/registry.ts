import { Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  OBSERVATORY_PLUGIN_API_VERSION,
  type AgentHarness,
  type AgentHarnessDescriptor,
  type HarnessError,
  type BoundedProcessRunner,
  type CodeHostingProvider,
  type ObservatoryPlugin,
  type PluginCapability,
  type PluginConfiguration,
  type PluginConfigurationValue,
  type PluginContributions,
} from "../plugin-sdk/index.ts";
import { BunBoundedProcessRunner } from "./process.ts";

export interface PluginManifest {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly apiVersion: 2;
  readonly entrypoint: string;
  readonly capabilities: readonly PluginCapability[];
}

export interface PluginStatus {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly capabilities: readonly PluginCapability[];
  readonly state: "ready" | "degraded" | "disabled";
  readonly diagnostics: readonly string[];
}

export interface PluginRegistry {
  agentHarnesses(): readonly AgentHarness[];
  agentHarness(harnessId: string): AgentHarness | undefined;
  availableAgentHarnesses(): Effect.Effect<readonly AgentHarnessDescriptor[], HarnessError>;
  codeHosts(): readonly CodeHostingProvider[];
  status(): readonly PluginStatus[];
  close(): Effect.Effect<void>;
}

export interface PluginPackageConfiguration {
  readonly path: string;
  readonly enabled?: boolean;
  readonly config?: PluginConfiguration;
}

const PluginConfigurationValueSchema: Schema.Schema<PluginConfigurationValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(PluginConfigurationValueSchema),
    PluginConfigurationSchema,
  ),
);
const PluginConfigurationSchema: Schema.Schema<PluginConfiguration> = Schema.Record({
  key: Schema.String,
  value: PluginConfigurationValueSchema,
});
const PluginPackageConfigurationSchema = Schema.Struct({
  path: Schema.String,
  enabled: Schema.optional(Schema.Boolean),
  config: Schema.optional(PluginConfigurationSchema),
});
const PluginConfigurationFileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  plugins: Schema.Array(PluginPackageConfigurationSchema),
});
const PluginManifestSchema: Schema.Schema<PluginManifest> = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  displayName: Schema.String,
  version: Schema.String,
  apiVersion: Schema.Literal(OBSERVATORY_PLUGIN_API_VERSION),
  entrypoint: Schema.String,
  capabilities: Schema.Array(Schema.Literal("agent-harness", "code-host")),
});

export const readPluginConfiguration = async (
  path: string | undefined,
): Promise<readonly PluginPackageConfiguration[]> => {
  if (!path) return [];
  return Schema.decodeUnknownSync(Schema.parseJson(PluginConfigurationFileSchema))(
    await readFile(resolve(path), "utf8"),
  ).plugins;
};

interface LoadedPlugin {
  readonly status: PluginStatus;
  readonly contributions?: PluginContributions;
}

const readyStatus = (manifest: PluginManifest): PluginStatus => ({
  id: manifest.id,
  displayName: manifest.displayName,
  version: manifest.version,
  apiVersion: manifest.apiVersion,
  capabilities: manifest.capabilities,
  state: "ready",
  diagnostics: [],
});

const safeEntrypoint = (packagePath: string, entrypoint: string): string => {
  if (isAbsolute(entrypoint)) throw new Error("Plugin entrypoint must be package-relative.");
  const resolved = resolve(packagePath, entrypoint);
  const remaining = relative(packagePath, resolved);
  if (!remaining || remaining.startsWith(".."))
    throw new Error("Plugin entrypoint must stay inside its package.");
  return resolved;
};

const activatePackage = async (
  packageConfiguration: PluginPackageConfiguration,
  runner: BoundedProcessRunner,
  now: () => number,
): Promise<LoadedPlugin> => {
  let manifest: PluginManifest | undefined;
  try {
    const packagePath = resolve(packageConfiguration.path);
    manifest = Schema.decodeUnknownSync(Schema.parseJson(PluginManifestSchema))(
      await readFile(resolve(packagePath, "observatory.plugin.json"), "utf8"),
    );
    if (packageConfiguration.enabled === false)
      return {
        status: {
          ...readyStatus(manifest),
          state: "disabled",
          diagnostics: ["Disabled by local configuration."],
        },
      };
    const entrypoint = safeEntrypoint(packagePath, manifest.entrypoint);
    const module: unknown = await import(pathToFileURL(entrypoint).href);
    // SAFETY: The plugin entrypoint is trusted local code; invoking its declared export is contained
    // by this activation boundary and any malformed shape becomes a degraded plugin diagnostic.
    const plugin = (module as { readonly plugin: ObservatoryPlugin }).plugin;
    const contributions = await plugin.activate({
      config: packageConfiguration.config ?? {},
      process: runner,
      now,
      logger: {
        info: (message) => console.info(`[plugin:${manifest?.id ?? "unknown"}] ${message}`),
        warn: (message) => console.warn(`[plugin:${manifest?.id ?? "unknown"}] ${message}`),
      },
    });
    const codeHosts = contributions.codeHosts ?? [];
    const agentHarnesses = contributions.agentHarnesses ?? [];
    if (manifest.capabilities.includes("code-host") !== codeHosts.length > 0)
      throw new Error("Activated capabilities do not match the plugin manifest.");
    if (manifest.capabilities.includes("agent-harness") !== agentHarnesses.length > 0)
      throw new Error("Activated capabilities do not match the plugin manifest.");
    const harnessIds = new Set<string>();
    for (const harness of agentHarnesses) {
      const harnessId = harness.harnessId.trim();
      if (!harnessId || harness.describe().harnessId !== harnessId)
        throw new Error("An agent harness has an invalid descriptor identity.");
      if (harnessIds.has(harnessId))
        throw new Error(`Duplicate agent harness id in plugin: ${harnessId}`);
      harnessIds.add(harnessId);
    }
    return {
      status: readyStatus(manifest),
      contributions,
    };
  } catch (error) {
    const fallback = manifest ?? {
      id: dirname(packageConfiguration.path).split("/").at(-1) ?? "unknown",
      displayName: "Invalid plugin",
      version: "unknown",
      apiVersion: 0,
      capabilities: [],
    };
    return {
      status: {
        id: fallback.id,
        displayName: fallback.displayName,
        version: fallback.version,
        apiVersion: fallback.apiVersion,
        capabilities: fallback.capabilities,
        state: "degraded",
        diagnostics: [error instanceof Error ? error.message.slice(0, 300) : "Plugin failed."],
      },
    };
  }
};

class LoadedPluginRegistry implements PluginRegistry {
  constructor(private readonly plugins: readonly LoadedPlugin[]) {}

  agentHarnesses(): readonly AgentHarness[] {
    const harnesses = this.plugins.flatMap((loaded) => loaded.contributions?.agentHarnesses ?? []);
    const seen = new Set<string>();
    return harnesses.filter((harness) => {
      if (seen.has(harness.harnessId)) return false;
      seen.add(harness.harnessId);
      return true;
    });
  }

  agentHarness(harnessId: string): AgentHarness | undefined {
    const normalized = harnessId.trim();
    return this.agentHarnesses().find((harness) => harness.harnessId === normalized);
  }

  availableAgentHarnesses(): Effect.Effect<readonly AgentHarnessDescriptor[], HarnessError> {
    return Effect.forEach(
      this.agentHarnesses(),
      (harness) =>
        harness
          .availability()
          .pipe(
            Effect.map((availability) => (availability.available ? harness.describe() : undefined)),
          ),
      { concurrency: "unbounded" },
    ).pipe(Effect.map((descriptors) => descriptors.filter((value) => value !== undefined)));
  }

  codeHosts(): readonly CodeHostingProvider[] {
    return this.plugins.flatMap((loaded) => loaded.contributions?.codeHosts ?? []);
  }

  status(): readonly PluginStatus[] {
    return this.plugins.map((loaded) => loaded.status);
  }

  close(): Effect.Effect<void> {
    return Effect.promise(async () => {
      await Promise.allSettled(
        this.plugins.map(async (loaded) => loaded.contributions?.dispose?.()),
      );
    });
  }
}

export const loadPluginRegistry = (options: {
  readonly packages: readonly PluginPackageConfiguration[];
  readonly runner?: BoundedProcessRunner;
  readonly now?: () => number;
}): Effect.Effect<PluginRegistry> =>
  Effect.promise(async () => {
    const runner = options.runner ?? new BunBoundedProcessRunner();
    const now = options.now ?? Date.now;
    const loaded: LoadedPlugin[] = [];
    const ids = new Set<string>();
    const harnessIds = new Set<string>();
    for (const packageConfiguration of options.packages) {
      // Plugin activation is ordered so duplicate ids are deterministic.
      // eslint-disable-next-line no-await-in-loop
      const plugin = await activatePackage(packageConfiguration, runner, now);
      if (ids.has(plugin.status.id)) {
        loaded.push({
          status: {
            ...plugin.status,
            state: "degraded",
            diagnostics: ["A plugin with this id is already loaded."],
          },
        });
        continue;
      }
      const duplicateHarness = plugin.contributions?.agentHarnesses?.find((harness) =>
        harnessIds.has(harness.harnessId),
      );
      if (duplicateHarness) {
        loaded.push({
          status: {
            ...plugin.status,
            state: "degraded",
            diagnostics: [`Agent harness id ${duplicateHarness.harnessId} is already contributed.`],
          },
        });
        continue;
      }
      ids.add(plugin.status.id);
      for (const harness of plugin.contributions?.agentHarnesses ?? [])
        harnessIds.add(harness.harnessId);
      loaded.push(plugin);
    }
    return new LoadedPluginRegistry(loaded);
  });
