import { useCallback, useEffect, useState } from "react";
import type { InspectorProjection } from "../../../src/projection/types.ts";
import type { RendererSubject } from "../../../src/web/protocol.ts";
import { fetchInspector } from "../api/client.ts";
import type { Selection } from "../app/selection.ts";

export const useInspector = (
  selection: Selection | undefined,
  affected: readonly RendererSubject[] | undefined,
  affectedAll: boolean | undefined,
) => {
  const [projection, setProjection] = useState<InspectorProjection>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (
      selection &&
      (affectedAll ||
        affected?.some((subject) => subject.type === selection.type && subject.id === selection.id))
    )
      refresh();
  }, [affected, affectedAll, selection, refresh]);

  useEffect(() => {
    setProjection(undefined);
    setError(undefined);
  }, [selection]);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    setError(undefined);
    void fetchInspector(selection.type, selection.id, controller.signal)
      .then(setProjection)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Inspector unavailable.");
      });
    return () => controller.abort();
  }, [selection, revision]);

  return { projection, error, refresh };
};
