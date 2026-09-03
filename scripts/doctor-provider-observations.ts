import { Schema } from "effect";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  observationInstallManifest,
  providerHarnessIds,
  providerLabel,
  providerSettingsPath,
  ProviderObservationInstallManifestSchema,
  type ProviderHarnessId,
} from "../plugins/agent-harnesses/provider-observation-installation.ts";
import { validProviderObservationToken } from "../src/agent-observations/ingress.ts";

const MAX_SETTINGS_BYTES = 1024 * 1024;

export interface ProviderObservationDoctorEntry {
  readonly harnessId: ProviderHarnessId;
  readonly label: string;
  readonly configured: boolean;
  readonly bundlePresent: boolean;
  readonly tokenValid: boolean;
  readonly endpoint: string;
  readonly trust: "unknown";
  readonly diagnostics: readonly string[];
}

export interface ProviderObservationDoctorReport {
  readonly installationPresent: boolean;
  readonly buildId?: string;
  readonly providers: readonly ProviderObservationDoctorEntry[];
}

const filePresent = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const boundedText = async (path: string): Promise<string | undefined> => {
  try {
    const metadata = await stat(path);
    if (metadata.size > MAX_SETTINGS_BYTES) return undefined;
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
};

const tokenFileValid = async (path: string): Promise<boolean> => {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size > 256 || (metadata.mode & 0o077) !== 0) return false;
    return validProviderObservationToken((await readFile(path, "utf8")).trim());
  } catch {
    return false;
  }
};

export const inspectProviderObservations = async (
  baseHome = homedir(),
): Promise<ProviderObservationDoctorReport> => {
  const manifestText = await boundedText(observationInstallManifest(baseHome));
  if (!manifestText) return { installationPresent: false, providers: [] };
  let manifest;
  try {
    manifest = Schema.decodeUnknownSync(Schema.parseJson(ProviderObservationInstallManifestSchema))(
      manifestText,
    );
  } catch {
    return { installationPresent: false, providers: [] };
  }

  const commandBundlePresent = await filePresent(manifest.commandHook);
  const piBundlePresent = await filePresent(manifest.piExtension);
  const tokenValid = await tokenFileValid(manifest.tokenFile);
  const providers = await Promise.all(
    providerHarnessIds.map(async (harnessId): Promise<ProviderObservationDoctorEntry> => {
      const settings = await boundedText(providerSettingsPath(harnessId, baseHome));
      const expectedBundle = harnessId === "pi" ? manifest.piExtension : manifest.commandHook;
      const bundlePresent = harnessId === "pi" ? piBundlePresent : commandBundlePresent;
      const configured =
        settings !== undefined &&
        settings.includes(expectedBundle) &&
        (harnessId === "pi" ||
          (settings.includes(manifest.endpoint) && settings.includes(manifest.tokenFile)));
      return {
        harnessId,
        label: providerLabel(harnessId),
        configured,
        bundlePresent,
        tokenValid,
        endpoint: manifest.endpoint,
        trust: "unknown",
        diagnostics: [
          ...(configured ? [] : ["Installed provider configuration does not match the manifest."]),
          ...(bundlePresent ? [] : ["Installed observation bundle is missing."]),
          ...(tokenValid ? [] : ["Observation delivery token is missing or invalid."]),
        ],
      };
    }),
  );
  return { installationPresent: true, buildId: manifest.buildId, providers };
};

if (import.meta.main) {
  const homeIndex = process.argv.indexOf("--home");
  const requestedHome = homeIndex >= 0 ? process.argv[homeIndex + 1] : undefined;
  const report = await inspectProviderObservations(
    requestedHome ? resolve(requestedHome) : homedir(),
  );
  if (!report.installationPresent) {
    console.log("Provider observations are not installed.");
  } else {
    console.log(`Provider observation build: ${report.buildId}`);
    for (const provider of report.providers) {
      const status =
        provider.configured && provider.bundlePresent && provider.tokenValid
          ? "configured"
          : "unavailable";
      console.log(
        `${provider.label}: ${status}; endpoint=${provider.endpoint}; trust=${provider.trust}`,
      );
      for (const diagnostic of provider.diagnostics) console.log(`  ${diagnostic}`);
    }
  }
}
