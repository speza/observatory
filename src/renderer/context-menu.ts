export type ContextMenuScope = "selection" | "inbox" | "empty";

export type ContextMenuTarget = {
  readonly type: "goal" | "agent";
  readonly id: string;
};

export type ContextMenuSelectionChange =
  | { readonly kind: "preserve" }
  | { readonly kind: "clear" }
  | { readonly kind: "select"; readonly target: ContextMenuTarget };

/** Describe the selection change made when a context-menu action is chosen. */
export const selectionChangeForContextAction = (
  scope: ContextMenuScope,
  target: ContextMenuTarget | undefined,
): ContextMenuSelectionChange => {
  if (scope === "inbox") return { kind: "clear" };
  if (target) return { kind: "select", target: { ...target } };
  return { kind: "preserve" };
};
