export interface InputKey {
  readonly name: string;
  readonly sequence: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly option: boolean;
}

export const isEraseKey = (key: InputKey): boolean =>
  key.name === "backspace" ||
  key.name === "delete" ||
  key.sequence === "\b" ||
  key.sequence === "\x7f";

export const typedCharacter = (key: InputKey): string => {
  if (key.ctrl || key.meta || key.option) return "";
  if (key.name === "space") return " ";
  const value = key.sequence || key.name;
  const code = value.codePointAt(0) ?? 0;
  return value.length === 1 && code >= 0x20 && code !== 0x7f ? value : "";
};
