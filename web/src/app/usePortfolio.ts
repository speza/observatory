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

export const latestPortfolio = (
  current: PortfolioResponse | undefined,
  candidate: PortfolioResponse,
): PortfolioResponse =>
  !current || candidate.map.generatedAt >= current.map.generatedAt ? candidate : current;

export const usePortfolio = (): PortfolioState => {
  const [state, setState] = useState<InternalPortfolioState>({});
  const request = useRef<AbortController | undefined>(undefined);
  const refreshEpoch = useRef(0);
  const streamCursor = useRef<{ readonly epoch: string; readonly revision: number } | undefined>(
    undefined,
  );
  const accept = useCallback((data: PortfolioResponse): void => {
    refreshEpoch.current += 1;
    request.current?.abort();
    setState((current) => ({
      ...current,
      data: latestPortfolio(current.data, data),
      error: undefined,
    }));
  }, []);

  useEffect(() => {
    let disposed = false;
    let lastStreamRecoveryAt = Date.now();
    const refresh = async (): Promise<void> => {
      const epoch = refreshEpoch.current;
      const controller = new AbortController();
      request.current?.abort();
      request.current = controller;
      try {
        const [data, pending] = await Promise.all([
          fetchPortfolio(controller.signal),
          fetchPendingLaunches({ signal: controller.signal }),
        ]);
        if (disposed || controller.signal.aborted || epoch !== refreshEpoch.current) return;
        setState((current) => ({
          ...current,
          data: latestPortfolio(current.data, data),
          pendingLaunches: pending.launches,
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

    const events = new EventSource(projectionEventsUrl());
    const apply = (message: Event): void => {
      if (!(message instanceof MessageEvent)) return;
      try {
        const event = decodeBrowserProjectionEvent(message.data);
        const previous = streamCursor.current;
        if (previous?.epoch === event.epoch && event.revision <= previous.revision) return;
        const epochChanged = previous !== undefined && previous.epoch !== event.epoch;
        streamCursor.current = { epoch: event.epoch, revision: event.revision };
        refreshEpoch.current += 1;
        request.current?.abort();
        if (event.kind === "snapshot") {
          setState((current) => ({
            data: epochChanged ? event.portfolio : latestPortfolio(current.data, event.portfolio),
            pendingLaunches: event.pendingLaunches,
            affected: event.affected,
            affectedAll: event.affectedAll,
          }));
        } else if (event.kind === "portfolio-replaced") {
          setState((current) => ({
            ...current,
            data: latestPortfolio(current.data, event.portfolio),
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
      if (Date.now() - lastStreamRecoveryAt >= 30_000) {
        lastStreamRecoveryAt = Date.now();
        void refresh();
      }
    });

    void refresh();
    const safetyTimer = window.setInterval(() => {
      if (events.readyState !== EventSource.OPEN) {
        lastStreamRecoveryAt = Date.now();
        void refresh();
      }
    }, 30_000);
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    const refreshWhenOnline = (): void => void refresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    return () => {
      disposed = true;
      refreshEpoch.current += 1;
      request.current?.abort();
      events.close();
      window.clearInterval(safetyTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, []);

  return { ...state, accept };
};
