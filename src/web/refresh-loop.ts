export interface SerializedRefreshLoop {
  stop(): void;
}

/** Schedule the next refresh only after the current asynchronous refresh settles. */
export const startSerializedRefreshLoop = (options: {
  readonly intervalMs: number;
  readonly refresh: () => Promise<void>;
  readonly onError: (message: string) => void;
}): SerializedRefreshLoop => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async (): Promise<void> => {
    try {
      await options.refresh();
    } catch (error) {
      options.onError(error instanceof Error ? error.message : "Refresh failed unexpectedly.");
    } finally {
      if (!stopped) timer = setTimeout(() => void run(), options.intervalMs);
    }
  };
  timer = setTimeout(() => void run(), options.intervalMs);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};
