/**
 * One batch destination, as chosen in the inspector. The `<select>` can only
 * carry strings, so encoding and decoding live here together: System and Goal
 * ids may themselves contain `:`, and only this module is allowed to split.
 */
export type BatchDestination =
  | { readonly kind: "inbox" }
  | { readonly kind: "goal"; readonly id: string }
  | { readonly kind: "system"; readonly id: string };

export const batchDestinationValue = (destination: BatchDestination): string =>
  destination.kind === "inbox" ? "inbox" : `${destination.kind}:${destination.id}`;

export const parseBatchDestination = (value: string): BatchDestination | undefined => {
  if (value === "inbox") return { kind: "inbox" };
  const separator = value.indexOf(":");
  if (separator <= 0) return undefined;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id) return undefined;
  if (kind === "goal") return { kind: "goal", id };
  if (kind === "system") return { kind: "system", id };
  return undefined;
};
