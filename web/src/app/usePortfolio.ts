import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioResponse } from "../../../src/web/portfolio.ts";
import type {
  BrowserProjectionEvent,
  RendererSubject,
  WebPendingLaunch,
  WebPortfolioResponse,
} from "../../../src/web/protocol.ts";
import {
  decodeBrowserProjectionEvent,
  fetchPortfolio,
  projectionEventsUrl,
} from "../api/client.ts";

export interface PortfolioState {
  readonly data?: PortfolioResponse;
  readonly pendingLaunches?: readonly WebPendingLaunch[];
  readonly affected?: readonly RendererSubject[];
  readonly affectedAll?: boolean;
  readonly error?: string;
  readonly accept: (data: WebPortfolioResponse) => void;
}

type InternalPortfolioState = Omit<PortfolioState, "accept">;

const STREAM_BOOTSTRAP_TIMEOUT_MS = 5_000;
const REST_FALLBACK_COOLDOWN_MS = 30_000;

interface StreamRecovery {
  readonly start: () => void;
  readonly received: () => void;
  readonly unavailable: () => void;
  readonly dispose: () => void;
}

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

export interface PortfolioDeliveryState extends InternalPortfolioState {
  readonly epoch?: string;
  readonly retiredEpochs?: ReadonlySet<string>;
  readonly portfolioRevision?: number;
  readonly pendingRevision?: number;
}

export const reconcilePortfolio = (
  current: PortfolioDeliveryState,
  event: BrowserProjectionEvent,
  allowEpochChange = true,
): PortfolioDeliveryState => {
  if (current.retiredEpochs?.has(event.epoch)) return current;
  const changed = current.epoch !== undefined && current.epoch !== event.epoch;
  if (changed && !allowEpochChange) return current;
  const baseline: PortfolioDeliveryState = changed
    ? {
        epoch: event.epoch,
        retiredEpochs: new Set([...(current.retiredEpochs ?? []), current.epoch]),
      }
    : current;
  const portfolio =
    event.kind !== "pending-launches-replaced" &&
    event.revision > (baseline.portfolioRevision ?? -1);
  const pending =
    event.kind !== "portfolio-replaced" && event.revision > (baseline.pendingRevision ?? -1);
  if (!portfolio && !pending) return current;
  return {
    ...baseline,
    epoch: event.epoch,
    data: portfolio ? event.portfolio : baseline.data,
    portfolioRevision: portfolio ? event.revision : baseline.portfolioRevision,
    pendingLaunches: pending ? event.pendingLaunches : baseline.pendingLaunches,
    pendingRevision: pending ? event.revision : baseline.pendingRevision,
    affected: event.affected,
    affectedAll: event.affectedAll,
    error: undefined,
  };
};

export const portfolioDelivery = (data: WebPortfolioResponse): BrowserProjectionEvent => ({
  kind: "snapshot",
  epoch: data.epoch,
  revision: data.revision,
  generatedAt: data.map.generatedAt,
  portfolio: data,
  pendingLaunches: data.pendingLaunches,
  affected: [],
  affectedAll: true,
});

export const usePortfolio = (): PortfolioState => {
  const [state, setState] = useState<PortfolioDeliveryState>({});
  const request = useRef<AbortController | undefined>(undefined);
  const refreshEpoch = useRef(0);
  const needsFullRecovery = useRef(true);
  const delivery = useRef<PortfolioDeliveryState>({});
  const replaceStream = useRef<(() => void) | undefined>(undefined);
  const receive = useCallback((event: BrowserProjectionEvent, allowEpochChange = true): boolean => {
    const previous = delivery.current;
    const next = reconcilePortfolio(previous, event, allowEpochChange);
    if (next === previous) return false;
    const adoptedEpoch = previous.epoch !== next.epoch;
    delivery.current = next;
    if (adoptedEpoch) {
      // Fence both transports, including first adoption: an unseen old SSE epoch
      // can still be buffered when a newer REST baseline wins the race.
      refreshEpoch.current += 1;
      request.current?.abort();
      needsFullRecovery.current = true;
    }
    if (event.kind === "snapshot") needsFullRecovery.current = false;
    if (adoptedEpoch) replaceStream.current?.();
    setState(next);
    return true;
  }, []);
  const accept = useCallback(
    (data: WebPortfolioResponse): void => {
      receive(portfolioDelivery(data), false);
    },
    [receive],
  );

  useEffect(() => {
    let disposed = false;
    const refresh = async (): Promise<void> => {
      const epoch = refreshEpoch.current;
      const controller = new AbortController();
      request.current?.abort();
      request.current = controller;
      try {
        const data = await fetchPortfolio(controller.signal);
        if (disposed || controller.signal.aborted || epoch !== refreshEpoch.current) return;
        receive(portfolioDelivery(data));
        if (epoch === refreshEpoch.current) recovery.received();
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

    let events: EventSource;
    const openStream = (): void => {
      const generation = refreshEpoch.current;
      events = new EventSource(projectionEventsUrl());
      const current = (): boolean => !disposed && generation === refreshEpoch.current;
      const apply = (message: Event): void => {
        // Stale callbacks must not decode, clear timers, or initiate recovery.
        if (!current() || !(message instanceof MessageEvent)) return;
        try {
          const event = decodeBrowserProjectionEvent(message.data);
          receive(event);
          if (current() && event.kind === "snapshot") recovery.received();
        } catch {
          if (!current()) return;
          // A malformed notification cannot replace the last valid projection.
          needsFullRecovery.current = true;
          recovery.unavailable();
        }
      };
      events.addEventListener("snapshot", apply);
      events.addEventListener("portfolio-replaced", apply);
      events.addEventListener("pending-launches-replaced", apply);
      events.addEventListener("open", () => {
        if (current()) setState((previous) => ({ ...previous, error: undefined }));
      });
      events.addEventListener("error", () => {
        if (!current()) return;
        setState((previous) => ({ ...previous, error: "Live updates disconnected; retrying." }));
        recovery.unavailable();
      });
    };
    replaceStream.current = () => {
      events.close();
      recovery.dispose();
      openStream();
      if (needsFullRecovery.current) recovery.start();
    };

    openStream();
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
      replaceStream.current = undefined;
      refreshEpoch.current += 1;
      request.current?.abort();
      events.close();
      recovery.dispose();
      window.clearInterval(safetyTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, [receive]);

  return { ...state, accept };
};
