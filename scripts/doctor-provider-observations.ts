import { Schema } from "effect";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  observationInstallManifest,
  observationMarker,
  providerHarnessIds,
  providerLabel,
  providerSettingsPath,
  ProviderObservationInstallManifestSchema,
  type ProviderHarnessId,
} from "../plugins/agent-harnesses/provider-observation-installation.ts";
import { ProviderObservationJournal } from "../plugins/agent-harnesses/provider-observation-journal.ts";

const MAX_SETTINGS_BYTES = 1024 * 1024;

export interface ProviderObservationDoctorEntry {
  readonly harnessId: ProviderHarnessId;
  readonly label: string;
  readonly configured: boolean;
  readonly bundlePresent: boolean;
  readonly markerPresent: boolean;
  readonly journalPresent: boolean;
  readonly journalHealth: string;
  readonly lastEventAt?: number;
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
  const providers = await Promise.all(
    providerHarnessIds.map(async (harnessId): Promise<ProviderObservationDoctorEntry> => {
      const configuration = manifest.providers[harnessId];
      const settings = await boundedText(providerSettingsPath(harnessId, baseHome));
      const expectedBundle = harnessId === "pi" ? manifest.piExtension : manifest.commandHook;
      const bundlePresent = harnessId === "pi" ? piBundlePresent : commandBundlePresent;
      const configured =
        settings !== undefined &&
        settings.includes(expectedBundle) &&
        (harnessId === "pi" ||
          (settings.includes(configuration.outbox) && settings.includes(configuration.root)));
      const markerPresent = await filePresent(observationMarker(configuration.outbox));
      const inspection = await new ProviderObservationJournal({
        harnessId,
        path: configuration.outbox,
        root: configuration.root,
      }).inspect();
      return {
        harnessId,
        label: providerLabel(harnessId),
        configured,
        bundlePresent,
        markerPresent,
        journalPresent: inspection.filePresent,
        journalHealth: inspection.health,
        lastEventAt: inspection.lastEventAt,
        trust: "unknown",
        diagnostics: [
          ...inspection.diagnostics,
          ...(configured ? [] : ["Installed provider configuration does not match the manifest."]),
          ...(bundlePresent ? [] : ["Installed observation bundle is missing."]),
          ...(markerPresent ? [] : ["Observation configuration marker is missing."]),
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
        provider.configured && provider.bundlePresent && provider.markerPresent
          ? provider.journalHealth
          : "unavailable";
      console.log(
        `${provider.label}: ${status}; journal=${provider.journalPresent ? "present" : "missing"}; trust=${provider.trust}`,
      );
      for (const diagnostic of provider.diagnostics) console.log(`  ${diagnostic}`);
    }
  }
}
