import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeToggle } from "./ThemeToggle.tsx";

test("ThemeToggle presents the opposite theme as an icon action", () => {
  const lightMarkup = renderToStaticMarkup(
    <ThemeToggle onToggle={() => undefined} theme="light" />,
  );
  const darkMarkup = renderToStaticMarkup(<ThemeToggle onToggle={() => undefined} theme="dark" />);

  expect(lightMarkup).toContain('aria-label="Switch to dark theme"');
  expect(lightMarkup).toContain("M20.985 12.486");
  expect(darkMarkup).toContain('aria-label="Switch to light theme"');
  expect(darkMarkup).toContain('<circle cx="12" cy="12" r="4"');
});
