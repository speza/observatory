export interface SerializedRefreshLoop {
  refreshNow(): Promise<void>;
  stop(): Promise<void>;
}

/** Schedule the next refresh only after the current asynchronous refresh settles. */
export const startSerializedRefreshLoop = (options: {
  readonly intervalMs: number;
  readonly refresh: () => Promise<void>;
  readonly onError: (message: string) => void;
}): SerializedRefreshLoop => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;
  const schedule = (): void => {
    if (!stopped)
      timer = setTimeout(() => {
        void refreshNow().catch(() => undefined);
      }, options.intervalMs);
  };
  const run = async (): Promise<void> => {
    try {
      await options.refresh();
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "Refresh failed unexpectedly.");
      throw error;
    } finally {
      active = undefined;
      schedule();
    }
  };
  const refreshNow = (): Promise<void> => {
    if (stopped) return Promise.reject(new Error("Refresh loop is stopped."));
    if (active) return active;
    if (timer) clearTimeout(timer);
    timer = undefined;
    active = run();
    return active;
  };
  schedule();
  return {
    refreshNow,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await active;
    },
  };
};
