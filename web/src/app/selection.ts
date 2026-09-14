/**
 * Renderer-only selection state. Selection is transient presentation context:
 * it is never persisted and never becomes trusted Universe state. Only the
 * batches of Agents it carries become durable, and only when an explicit
 * assignment command is submitted.
 */
export interface Selection {
  readonly type: "goal" | "agent" | "discovered-execution";
  readonly id: string;
}

export interface SelectionModel {
  /** Current subject for the inspector, camera focus and keyboard navigation. */
  readonly subject?: Selection;
  /** Every selected Agent. Empty unless `subject` is an Agent. */
  readonly agentIds: ReadonlySet<string>;
  /** Range origin for Shift selection. Always an Agent id inside `agentIds`. */
  readonly anchor?: string;
}

/** Modifier intent for one click or key press, shared by every surface. */
export interface SelectionIntent {
  readonly additive: boolean;
  readonly range: boolean;
}

export type AgentSelectionHandler = (
  agentId: string,
  intent: SelectionIntent,
  order: readonly string[],
) => void;

/** An explicit Agent set: "select all in this Goal", or a completed marquee drag. */
export type AgentSetSelectionHandler = (agentIds: readonly string[]) => void;

export const noSelection: SelectionModel = { agentIds: new Set() };

const agentSelection = (
  agentIds: ReadonlySet<string>,
  subject: string,
  anchor: string,
): SelectionModel => ({
  subject: { type: "agent", id: subject },
  agentIds,
  anchor,
});

export const selectionIntent = (event: {
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}): SelectionIntent => {
  const additive = event.metaKey || event.ctrlKey;
  return { additive, range: event.shiftKey && !additive };
};

/** A plain click or navigation move: replaces the selection and collapses any batch. */
export const onlySelection = (selection: Selection): SelectionModel =>
  selection.type === "agent"
    ? agentSelection(new Set([selection.id]), selection.id, selection.id)
    : { subject: selection, agentIds: new Set() };

export const selectedAgentIds = (model: SelectionModel): readonly string[] => [...model.agentIds];

export const isBatchAgentSelection = (model: SelectionModel): boolean => model.agentIds.size > 1;

/** Cmd/Ctrl-click: add or remove one Agent without disturbing the rest. */
export const toggleAgentSelection = (model: SelectionModel, agentId: string): SelectionModel => {
  if (!model.agentIds.has(agentId))
    return agentSelection(new Set(model.agentIds).add(agentId), agentId, model.anchor ?? agentId);
  const agentIds = new Set(model.agentIds);
  agentIds.delete(agentId);
  const remaining = [...agentIds];
  const subject =
    model.anchor !== undefined && agentIds.has(model.anchor) ? model.anchor : remaining[0];
  if (subject === undefined) return noSelection;
  return agentSelection(agentIds, subject, subject);
};

/**
 * Shift-click: replace the selection with the contiguous range between the
 * anchor and the target in the order the current surface displays.
 */
export const extendAgentSelection = (
  model: SelectionModel,
  agentId: string,
  order: readonly string[],
): SelectionModel => {
  const anchor = model.anchor;
  const from = anchor === undefined ? -1 : order.indexOf(anchor);
  const to = order.indexOf(agentId);
  if (from < 0 || to < 0 || anchor === undefined)
    return onlySelection({ type: "agent", id: agentId });
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return agentSelection(new Set(order.slice(start, end + 1)), agentId, anchor);
};
/** An explicit set, such as "select every Agent in this Goal" or a marquee. */
export const selectAgentSet = (agentIds: readonly string[], subject?: string): SelectionModel => {
  const ids = [...new Set(agentIds)];
  const first = ids[0];
  if (first === undefined) return noSelection;
  const current = subject !== undefined && ids.includes(subject) ? subject : first;
  return agentSelection(new Set(ids), current, current);
};

/** Drop Agents that no longer exist so a batch command can never span a stale id. */
export const pruneSelection = (
  model: SelectionModel,
  existingAgentIds: ReadonlySet<string>,
): SelectionModel => {
  if (model.subject?.type === "agent" && !existingAgentIds.has(model.subject.id))
    return noSelection;
  const kept = [...model.agentIds].filter((agentId) => existingAgentIds.has(agentId));
  if (kept.length === model.agentIds.size) return model;
  const first = kept[0];
  if (first === undefined) return { subject: model.subject, agentIds: new Set() };
  const subject =
    model.subject?.type === "agent" && kept.includes(model.subject.id) ? model.subject.id : first;
  const anchor = model.anchor !== undefined && kept.includes(model.anchor) ? model.anchor : subject;
  return agentSelection(new Set(kept), subject, anchor);
};
