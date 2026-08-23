import { describe, expect, test } from "bun:test";
import { modalFrameFor } from "./modal.ts";

describe("modal frame", () => {
  test("keeps a confirmation footer below its message", () => {
    const frame = modalFrameFor(140, 35, "confirm");

    expect(frame.height).toBe(7);
    expect(frame.footerY).toBeGreaterThan(frame.y + 4);
    expect(frame.footerY).toBe(frame.y + frame.height - 2);
  });

  test("shares centered geometry across modal kinds", () => {
    const frame = modalFrameFor(100, 30, "session-picker");

    expect(frame.x).toBeGreaterThan(0);
    expect(frame.y).toBeGreaterThan(0);
    expect(frame.contentX).toBe(frame.x + 2);
    expect(frame.footerY).toBeGreaterThan(frame.y + 12);
    expect(frame.footerY).toBe(frame.y + frame.height - 2);
  });

  test("caps wide-terminal dialogs at a readable width", () => {
    const frame = modalFrameFor(240, 40, "confirm");

    expect(frame.width).toBe(96);
    expect(frame.x).toBe(72);
  });
});
