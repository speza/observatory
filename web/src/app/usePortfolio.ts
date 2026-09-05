import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioResponse } from "../../../src/web/portfolio.ts";
import type { RendererSubject, WebPendingLaunch } from "../../../src/web/protocol.ts";
import {
  decodeBrowserProjectionEvent,
  fetchPendingLaunches,
  fetchPortfolio,
  projectionEventsUrl,
} from "../api/client.ts";

export interface PortfolioState {
  readonly data?: PortfolioResponse;
  readonly pendingLaunches?: readonly WebPendingLaunch[];
  readonly affected?: readonly RendererSubject[];
  readonly affectedAll?: boolean;
  readonly error?: string;
  readonly accept: (data: PortfolioResponse) => void;
}

type InternalPortfolioState = Omit<PortfolioState, "accept">;

const STREAM_BOOTSTRAP_TIMEOUT_MS = 5_000;
const REST_FALLBACK_COOLDOWN_MS = 30_000;

type StreamCursor = { readonly epoch: string; readonly revision: number };
interface StreamCursorDecision {
  readonly accept: boolean;
  readonly epochChanged: boolean;
}
interface StreamRecovery {
  readonly start: () => void;
  readonly received: () => void;
  readonly unavailable: () => void;
  readonly dispose: () => void;
}

export const advanceStreamCursor = (
  previous: StreamCursor | undefined,
  candidate: StreamCursor,
): StreamCursorDecision => ({
  accept: previous?.epoch !== candidate.epoch || candidate.revision > previous.revision,
  epochChanged: previous !== undefined && previous.epoch !== candidate.epoch,
});

export const createStreamRecovery = (options: {
  readonly recover: () => void;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, delay: number) => number;
  readonly clearTimer?: (timer: number) => void;
}): StreamRecovery => {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? window.setTimeout.bind(window);
  const clearTimer = options.clearTimer ?? window.clearTimeout.bind(window);
  let bootstrapTimer: number | undefined;
  let lastRecoveryAt = Number.NEGATIVE_INFINITY;
  const recover = (): void => {
    const current = now();
    if (current - lastRecoveryAt < REST_FALLBACK_COOLDOWN_MS) return;
    lastRecoveryAt = current;
    options.recover();
  };
  const received = (): void => {
    if (bootstrapTimer === undefined) return;
    clearTimer(bootstrapTimer);
    bootstrapTimer = undefined;
  };
  return {
    start: () => {
      bootstrapTimer = setTimer(recover, STREAM_BOOTSTRAP_TIMEOUT_MS);
    },
    received,
    unavailable: recover,
    dispose: received,
  };
};

export const latestPortfolio = (
  current: PortfolioResponse | undefined,
  candidate: PortfolioResponse,
): PortfolioResponse =>
  !current || candidate.map.generatedAt >= current.map.generatedAt ? candidate : current;

export const usePortfolio = (): PortfolioState => {
  const [state, setState] = useState<InternalPortfolioState>({});
  const request = useRef<AbortController | undefined>(undefined);
  const refreshEpoch = useRef(0);
  const streamCursor = useRef<StreamCursor | undefined>(undefined);
  const needsFullRecovery = useRef(true);
  const pendingGeneration = useRef(0);
  const replacePriorEpochPortfolio = useRef(false);
  const accept = useCallback((data: PortfolioResponse): void => {
    refreshEpoch.current += 1;
    request.current?.abort();
    const replacePortfolio = replacePriorEpochPortfolio.current;
    replacePriorEpochPortfolio.current = false;
    setState((current) => ({
      ...current,
      data: replacePortfolio ? data : latestPortfolio(current.data, data),
      error: undefined,
    }));
  }, []);

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      const epoch = refreshEpoch.current;
      const pendingAtStart = pendingGeneration.current;
      const controller = new AbortController();
      request.current?.abort();
      request.current = controller;
      try {
        const [data, pending] = await Promise.all([
          fetchPortfolio(controller.signal),
          fetchPendingLaunches({ signal: controller.signal }),
        ]);
        if (disposed || controller.signal.aborted || epoch !== refreshEpoch.current) return;
        const acceptPending = pendingAtStart === pendingGeneration.current;
        const replacePortfolio = replacePriorEpochPortfolio.current;
        replacePriorEpochPortfolio.current = false;
        needsFullRecovery.current = false;
        recovery.received();
        setState((current) => ({
          ...current,
          data: replacePortfolio ? data : latestPortfolio(current.data, data),
          pendingLaunches: acceptPending ? pending.launches : current.pendingLaunches,
          error: undefined,
        }));
      } catch (error) {
        if (disposed || controller.signal.aborted || epoch !== refreshEpoch.current) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Observatory refresh failed.",
        }));
      } finally {
        if (request.current === controller) request.current = undefined;
      }
    };

    const recovery = createStreamRecovery({ recover: () => void refresh() });

    const events = new EventSource(projectionEventsUrl());
    const apply = (message: Event): void => {
      if (!(message instanceof MessageEvent)) return;
      try {
        const event = decodeBrowserProjectionEvent(message.data);
        const previous = streamCursor.current;
        const cursor = advanceStreamCursor(previous, event);
        if (!cursor.accept) return;
        streamCursor.current = { epoch: event.epoch, revision: event.revision };
        if (cursor.epochChanged) {
          needsFullRecovery.current = true;
          replacePriorEpochPortfolio.current = true;
          refreshEpoch.current += 1;
          request.current?.abort();
        }
        const replacePortfolio = replacePriorEpochPortfolio.current;
        if (event.kind !== "pending-launches-replaced") replacePriorEpochPortfolio.current = false;
        if (event.kind !== "portfolio-replaced") pendingGeneration.current += 1;
        if (event.kind === "snapshot") {
          needsFullRecovery.current = false;
          recovery.received();
          refreshEpoch.current += 1;
          request.current?.abort();
          setState((current) => ({
            data: replacePortfolio
              ? event.portfolio
              : latestPortfolio(current.data, event.portfolio),
            pendingLaunches: event.pendingLaunches,
            affected: event.affected,
            affectedAll: event.affectedAll,
          }));
        } else if (event.kind === "portfolio-replaced") {
          setState((current) => ({
            ...current,
            data: replacePortfolio
              ? event.portfolio
              : latestPortfolio(current.data, event.portfolio),
            affected: event.affected,
            affectedAll: event.affectedAll,
            error: undefined,
          }));
        } else {
          setState((current) => ({
            ...current,
            pendingLaunches: event.pendingLaunches,
            affected: event.affected,
            affectedAll: event.affectedAll,
            error: undefined,
          }));
        }
      } catch {
        // A malformed notification cannot replace the last valid projection.
        needsFullRecovery.current = true;
        recovery.unavailable();
      }
    };
    events.addEventListener("snapshot", apply);
    events.addEventListener("portfolio-replaced", apply);
    events.addEventListener("pending-launches-replaced", apply);
    events.addEventListener("open", () => {
      if (!disposed) setState((current) => ({ ...current, error: undefined }));
    });
    events.addEventListener("error", () => {
      if (disposed) return;
      setState((current) => ({ ...current, error: "Live updates disconnected; retrying." }));
      recovery.unavailable();
    });

    recovery.start();
    const safetyTimer = window.setInterval(() => {
      if (needsFullRecovery.current || events.readyState !== EventSource.OPEN)
        recovery.unavailable();
    }, 30_000);
    const refreshWhenVisible = (): void => {
      if (
        document.visibilityState === "visible" &&
        (needsFullRecovery.current || events.readyState !== EventSource.OPEN)
      )
        recovery.unavailable();
    };
    const refreshWhenOnline = (): void => recovery.unavailable();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    return () => {
      disposed = true;
      refreshEpoch.current += 1;
      request.current?.abort();
      events.close();
      recovery.dispose();
      window.clearInterval(safetyTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, []);

  return { ...state, accept };
};
