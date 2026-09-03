import { Schema } from "effect";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ProviderHarnessId = "claude" | "codex" | "pi";

export const providerHarnessIds = ["claude", "codex", "pi"] as const;

export const validProviderObservationToken = (value: string): boolean =>
  /^[A-Za-z0-9_-]{43,128}$/u.test(value);

export const validObservationEndpoint = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.pathname === "/api/provider-observations" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
};

export const providerLabel = (harnessId: ProviderHarnessId): string => {
  if (harnessId === "claude") return "Claude Code";
  if (harnessId === "codex") return "Codex";
  return "Pi";
};

export const defaultProviderRoot = (harnessId: ProviderHarnessId, baseHome = homedir()): string => {
  if (harnessId === "claude") return join(baseHome, ".claude", "projects");
  if (harnessId === "codex") return join(baseHome, ".codex");
  return join(baseHome, ".pi", "agent");
};

export const observationScope = (harnessId: string, root: string): string =>
  createHash("sha256")
    .update(`${harnessId}\u0000${resolve(root)}`)
    .digest("hex")
    .slice(0, 24);

export const observationProviderInstance = (harnessId: string, scope: string): string =>
  `${harnessId}-local-${scope}`;

export interface ProviderObservationConfiguration {
  readonly root: string;
}

export type ProviderObservationConfigurations = Readonly<
  Record<ProviderHarnessId, ProviderObservationConfiguration>
>;

export const defaultProviderObservationConfigurations = (baseHome = homedir()) =>
  ({
    claude: { root: defaultProviderRoot("claude", baseHome) },
    codex: { root: defaultProviderRoot("codex", baseHome) },
    pi: { root: defaultProviderRoot("pi", baseHome) },
  }) satisfies ProviderObservationConfigurations;

export const providerSettingsPath = (
  harnessId: ProviderHarnessId,
  baseHome = homedir(),
): string => {
  if (harnessId === "claude") return join(baseHome, ".claude", "settings.json");
  if (harnessId === "codex") return join(baseHome, ".codex", "hooks.json");
  return join(baseHome, ".pi", "agent", "settings.json");
};

export const observationInstallRoot = (baseHome = homedir()): string =>
  join(baseHome, ".local", "share", "observatory", "hooks");

export const observationInstallManifest = (baseHome = homedir()): string =>
  join(observationInstallRoot(baseHome), "installation.json");

const ProviderConfigurationSchema = Schema.Struct({ root: Schema.String });
export const ProviderObservationInstallManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  installedAt: Schema.Number,
  buildId: Schema.String,
  commandHook: Schema.String,
  piExtension: Schema.String,
  endpoint: Schema.String,
  tokenFile: Schema.String,
  providers: Schema.Struct({
    claude: ProviderConfigurationSchema,
    codex: ProviderConfigurationSchema,
    pi: ProviderConfigurationSchema,
  }),
});
export type ProviderObservationInstallManifest =
  typeof ProviderObservationInstallManifestSchema.Type;
