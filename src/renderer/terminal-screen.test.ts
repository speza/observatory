import { describe, expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
import { TerminalScreen } from "./terminal-screen.ts";

const textOf = (screen: TerminalScreen): string =>
  screen
    .toStyledText()
    .chunks.map((chunk) => chunk.text)
    .join("");

describe("TerminalScreen", () => {
  test("renders text and preserves ANSI style attributes", () => {
    const screen = new TerminalScreen(24, 8);
    screen.write("\u001b[1;31mred\u001b[0m plain");
    const styled = screen.toStyledText();
    expect(textOf(screen)).toContain("red plain");
    expect(styled.chunks.some((chunk) => chunk.text.includes("red"))).toBe(true);
    expect(styled.chunks.some((chunk) => (chunk.attributes ?? 0) & TextAttributes.BOLD)).toBe(true);
    expect(screen.ansiSequences).toBe(2);
  });

  test("handles cursor movement, erase and alternate screen restore", () => {
    const screen = new TerminalScreen(24, 8);
    screen.write("base");
    screen.write("\u001b[?1049h\u001b[2J\u001b[Hoverlay\u001b[?1049l");
    expect(textOf(screen)).toContain("base");
    expect(textOf(screen)).not.toContain("overlay");
    expect(screen.alternateScreen).toBe(false);
  });

  test("tracks terminal mouse reporting modes for native wheel input", () => {
    const screen = new TerminalScreen(24, 8);
    screen.write("\u001b[?1000h\u001b[?1006h");

    expect(screen.mouseReporting).toBe(true);
    expect(screen.sgrMouse).toBe(true);

    screen.write("\u001b[?1000l\u001b[?1006l");
    expect(screen.mouseReporting).toBe(false);
    expect(screen.sgrMouse).toBe(false);
  });

  test("keeps local scrollback while an agent owns the alternate screen", () => {
    const screen = new TerminalScreen(24, 8);
    screen.write("\u001b[?1049h\u001b[2J");
    screen.write(Array.from({ length: 20 }, (_value, index) => `alt-${index}\r\n`).join(""));

    expect(screen.alternateScreen).toBe(true);
    expect(screen.scrollbackLines).toBeGreaterThan(1);
    expect(screen.scrollBy(1)).toBe(true);
    expect(screen.isScrolled).toBe(true);
    expect(screen.scrollToTop()).toBe(true);
    expect(textOf(screen)).toContain("alt-0");
  });

  test("supports split UTF-8 input and bounded resizing", () => {
    const screen = new TerminalScreen(2, 2);
    const bytes = new TextEncoder().encode("£");
    screen.write(bytes.slice(0, 1));
    screen.write(bytes.slice(1));
    screen.resize(100, 40);
    expect(screen.columns).toBe(100);
    expect(screen.rows).toBe(40);
    expect(textOf(screen)).toContain("£");
  });

  test("keeps scrollback and navigates between history and the live screen", () => {
    const screen = new TerminalScreen(24, 8);
    screen.write(Array.from({ length: 20 }, (_value, index) => `line-${index}\n`).join(""));

    expect(screen.scrollbackLines).toBeGreaterThan(1);
    expect(screen.isScrolled).toBe(false);
    expect(screen.scrollBy(1)).toBe(true);
    expect(screen.isScrolled).toBe(true);

    expect(screen.scrollToTop()).toBe(true);
    expect(textOf(screen)).toContain("line-0");
    expect(screen.scrollToBottom()).toBe(true);
    expect(screen.isScrolled).toBe(false);
    expect(textOf(screen)).toContain("line-19");
  });
});
