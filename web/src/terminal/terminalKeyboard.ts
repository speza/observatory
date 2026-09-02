export type TerminalKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey" | "type"
>;

const SHIFT_ENTER_CSI_U = Uint8Array.of(0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x32, 0x75);

export const isModifiedTerminalKey = (event: TerminalKeyboardEvent): boolean =>
  event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;

export const modifiedTerminalInput = (event: TerminalKeyboardEvent): Uint8Array | undefined => {
  if (event.type !== "keydown" || !isModifiedTerminalKey(event)) return undefined;

  return SHIFT_ENTER_CSI_U;
};
