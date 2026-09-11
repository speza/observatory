import { startSerializedRefreshLoop } from "./refresh-loop.ts";

export type RefreshScope = "host" | "observations" | "provider";

export interface ObservatoryRefreshTargets {
  readonly refreshHost: () => Promise<void>;
  readonly refreshObservations: () => Promise<void>;
  readonly refreshProvider: () => Promise<void>;
}

export interface ObservatoryRefreshLoops {
  stop(): void;
}

/**
 * The single composition point for observatory refresh cadence. Provider
 * catalogue re-indexing belongs here: a session started after boot must enter
 * the catalogue without a restart, or its discovery can never be admitted.
 */
export const startObservatoryRefreshLoops = (options: {
  readonly refreshMs: number;
  readonly observationRefreshMs?: number;
  readonly providerRefreshMs: number;
  readonly useMockHost: boolean;
  readonly targets: ObservatoryRefreshTargets;
  readonly onError: (message: string, scope: RefreshScope) => void;
}): ObservatoryRefreshLoops => {
  const host = startSerializedRefreshLoop({
    intervalMs: options.refreshMs,
    refresh: options.targets.refreshHost,
    onError: (message) => options.onError(message, "host"),
  });
  const observations =
    options.observationRefreshMs === undefined
      ? undefined
      : startSerializedRefreshLoop({
          intervalMs: options.observationRefreshMs,
          refresh: options.targets.refreshObservations,
          onError: (message) => options.onError(message, "observations"),
        });
  const provider = options.useMockHost
    ? undefined
    : startSerializedRefreshLoop({
        intervalMs: options.providerRefreshMs,
        refresh: options.targets.refreshProvider,
        onError: (message) => options.onError(message, "provider"),
      });
  return {
    stop: () => {
      host.stop();
      observations?.stop();
      provider?.stop();
    },
  };
};
