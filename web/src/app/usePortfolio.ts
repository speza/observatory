import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioResponse } from "../../../src/web/api.ts";
import { fetchPortfolio } from "../api/client.ts";

export interface PortfolioState {
  readonly data?: PortfolioResponse;
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
  const accept = useCallback((data: PortfolioResponse): void => {
    refreshEpoch.current += 1;
    request.current?.abort();
    setState((current) => ({ data: latestPortfolio(current.data, data) }));
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const refresh = async (): Promise<void> => {
      const epoch = refreshEpoch.current;
      const controller = new AbortController();
      request.current = controller;
      try {
        const data = await fetchPortfolio(controller.signal);
        if (disposed || controller.signal.aborted || epoch !== refreshEpoch.current) return;
        setState((current) => ({ data: latestPortfolio(current.data, data) }));
      } catch (error) {
        if (disposed || controller.signal.aborted || epoch !== refreshEpoch.current) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Observatory refresh failed.",
        }));
      } finally {
        if (request.current === controller) request.current = undefined;
        if (!disposed) timer = window.setTimeout(() => void refresh(), 2_000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      refreshEpoch.current += 1;
      request.current?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [accept]);

  return { ...state, accept };
};
