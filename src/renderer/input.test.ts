import { describe, expect, test } from "bun:test";
import { isEraseKey, typedCharacter, type InputKey } from "./input.ts";

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
    expect(isEraseKey(key({ name: "delete", sequence: "\u001b[3~" }))).toBe(
      true,
    );
    expect(isEraseKey(key({ name: "unknown", sequence: "\b" }))).toBe(true);
    expect(isEraseKey(key({ name: "unknown", sequence: "x" }))).toBe(false);
  });

  test("keeps printable text and space input intact", () => {
    expect(typedCharacter(key())).toBe("a");
    expect(typedCharacter(key({ name: "space", sequence: " " }))).toBe(" ");
    expect(typedCharacter(key({ name: "a", sequence: "a", ctrl: true }))).toBe(
      "",
    );
  });
});
