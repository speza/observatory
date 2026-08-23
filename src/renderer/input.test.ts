import { describe, expect, test } from "bun:test";
import {
  editText,
  insertTextAtCursor,
  isEraseKey,
  typedCharacter,
  type InputKey,
} from "./input.ts";

const key = (overrides: Partial<InputKey> = {}): InputKey => ({
  name: "a",
  sequence: "a",
  ctrl: false,
  meta: false,
  option: false,
  ...overrides,
});

describe("terminal text input", () => {
  test("does not treat DEL backspace as text", () => {
    const backspace = key({ name: "backspace", sequence: "\x7f" });

    expect(typedCharacter(backspace)).toBe("");
    expect(isEraseKey(backspace)).toBe(true);
  });

  test("recognizes named delete and control-sequence erase keys", () => {
    expect(isEraseKey(key({ name: "delete", sequence: "\u001b[3~" }))).toBe(true);
    expect(isEraseKey(key({ name: "unknown", sequence: "\b" }))).toBe(true);
    expect(isEraseKey(key({ name: "unknown", sequence: "x" }))).toBe(false);
  });

  test("keeps printable text and space input intact", () => {
    expect(typedCharacter(key())).toBe("a");
    expect(typedCharacter(key({ name: "space", sequence: " " }))).toBe(" ");
    expect(typedCharacter(key({ name: "a", sequence: "a", ctrl: true }))).toBe("");
  });

  test("edits in the middle with cursor navigation and delete", () => {
    const left = editText("abcd", 2, key({ name: "left", sequence: "\u001b[D" }));
    const inserted = editText(left.value, left.cursor, key({ name: "x", sequence: "x" }));
    const deleted = editText(
      inserted.value,
      inserted.cursor,
      key({ name: "delete", sequence: "\u001b[3~" }),
    );

    expect(left.cursor).toBe(1);
    expect(inserted).toMatchObject({ value: "axbcd", cursor: 2 });
    expect(deleted).toMatchObject({ value: "axcd", cursor: 2 });
  });

  test("supports home/end, word jumps and single-line paste", () => {
    const home = editText("one two", 7, key({ name: "home", sequence: "\u001b[H" }));
    const end = editText(home.value, home.cursor, key({ name: "end", sequence: "\u001b[F" }));
    const word = editText("one two", 7, key({ name: "left", sequence: "\u001b[1;5D", ctrl: true }));
    const pasted = insertTextAtCursor("goal", 2, "new\ntext");

    expect(home.cursor).toBe(0);
    expect(end.cursor).toBe(7);
    expect(word.cursor).toBe(4);
    expect(pasted).toMatchObject({ value: "gonew textal", cursor: 10 });
  });
});
