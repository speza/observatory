import { useCallback, useEffect, useState } from "react";
import type { PortfolioResponse } from "../../src/web/api.ts";
import { fetchPortfolio } from "./api.ts";

export interface PortfolioState {
  readonly data?: PortfolioResponse;
  readonly error?: string;
  readonly accept: (data: PortfolioResponse) => void;
}

type InternalPortfolioState = Omit<PortfolioState, "accept">;

export const usePortfolio = (): PortfolioState => {
  const [state, setState] = useState<InternalPortfolioState>({});
  const accept = useCallback((data: PortfolioResponse): void => setState({ data }), []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async (): Promise<void> => {
      try {
        const data = await fetchPortfolio(controller.signal);
        setState({ data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Observatory refresh failed.",
        }));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [accept]);

  return { ...state, accept };
};
