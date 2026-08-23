export interface InputKey {
  readonly name: string;
  readonly sequence: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly option: boolean;
}

export interface TextEditResult {
  readonly value: string;
  readonly cursor: number;
  readonly handled: boolean;
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

const clampCursor = (value: string, cursor: number): number =>
  Math.max(0, Math.min(value.length, cursor));

const previousCharacter = (value: string, cursor: number): number => {
  const position = clampCursor(value, cursor);
  if (position < 2) return Math.max(0, position - 1);
  const code = value.charCodeAt(position - 1);
  return code >= 0xdc00 && code <= 0xdfff ? position - 2 : position - 1;
};

const nextCharacter = (value: string, cursor: number): number => {
  const position = clampCursor(value, cursor);
  if (position >= value.length) return value.length;
  const code = value.charCodeAt(position);
  return code >= 0xd800 && code <= 0xdbff ? Math.min(value.length, position + 2) : position + 1;
};

const previousWord = (value: string, cursor: number): number => {
  let position = clampCursor(value, cursor);
  while (position > 0 && /\s/u.test(value[position - 1] ?? ""))
    position = previousCharacter(value, position);
  while (position > 0 && !/\s/u.test(value[position - 1] ?? ""))
    position = previousCharacter(value, position);
  return position;
};

const nextWord = (value: string, cursor: number): number => {
  let position = clampCursor(value, cursor);
  while (position < value.length && /\s/u.test(value[position] ?? ""))
    position = nextCharacter(value, position);
  while (position < value.length && !/\s/u.test(value[position] ?? ""))
    position = nextCharacter(value, position);
  return position;
};

const unchanged = (value: string, cursor: number): TextEditResult => ({
  value,
  cursor: clampCursor(value, cursor),
  handled: false,
});

const moved = (value: string, cursor: number): TextEditResult => ({
  value,
  cursor,
  handled: true,
});

const replaceRange = (
  value: string,
  start: number,
  end: number,
  replacement: string,
): TextEditResult => ({
  value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
  cursor: start + replacement.length,
  handled: true,
});

/** Insert pasted or programmatic text at a single-line editor cursor. */
export const insertTextAtCursor = (value: string, cursor: number, text: string): TextEditResult => {
  const normalized = text.replace(/\r?\n|\r/gu, " ");
  const position = clampCursor(value, cursor);
  return normalized
    ? replaceRange(value, position, position, normalized)
    : unchanged(value, position);
};

/** Apply standard terminal/editor navigation and editing keys to a single-line value. */
export const editText = (value: string, cursor: number, key: InputKey): TextEditResult => {
  const position = clampCursor(value, cursor);
  const byWord = key.ctrl || key.meta || key.option;
  if (key.name === "left")
    return moved(
      value,
      byWord ? previousWord(value, position) : previousCharacter(value, position),
    );
  if (key.name === "right")
    return moved(value, byWord ? nextWord(value, position) : nextCharacter(value, position));
  if (key.name === "home" || (key.ctrl && key.name === "a")) return moved(value, 0);
  if (key.name === "end" || (key.ctrl && key.name === "e")) return moved(value, value.length);
  if (key.ctrl && key.name === "w") {
    const start = previousWord(value, position);
    return replaceRange(value, start, position, "");
  }
  if (key.ctrl && key.name === "u") return replaceRange(value, 0, position, "");
  if (key.ctrl && key.name === "k") return replaceRange(value, position, value.length, "");
  if (key.ctrl && key.name === "d")
    return position < value.length
      ? replaceRange(value, position, nextCharacter(value, position), "")
      : moved(value, position);
  if (isEraseKey(key)) {
    if (key.name === "delete") {
      const end = nextCharacter(value, position);
      return end === position ? moved(value, position) : replaceRange(value, position, end, "");
    }
    const start = previousCharacter(value, position);
    return start === position ? moved(value, position) : replaceRange(value, start, position, "");
  }
  const character = typedCharacter(key);
  return character ? insertTextAtCursor(value, position, character) : unchanged(value, position);
};
