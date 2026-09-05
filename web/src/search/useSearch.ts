import { useEffect, useState } from "react";
import type { SearchResult } from "../../../src/projection/types.ts";
import { fetchSearch } from "../api/client.ts";

export const useSearch = (open: boolean) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!open || !trimmedQuery) {
      setResults([]);
      setLoading(false);
      setError(undefined);
      return;
    }
    const controller = new AbortController();
    setResults([]);
    setLoading(true);
    setError(undefined);
    void fetchSearch(trimmedQuery, controller.signal)
      .then((projection) => setResults(projection.results))
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setResults([]);
          setError(cause instanceof Error ? cause.message : "Search unavailable.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, query]);

  return { query, setQuery, results, loading, error };
};
