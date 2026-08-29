import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GitHubMark } from "./GitHubMark.tsx";

describe("GitHubMark", () => {
  test("renders the official mark as a theme-aware decorative SVG", () => {
    const markup = renderToStaticMarkup(<GitHubMark className="github" />);

    expect(markup).toContain("<svg");
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('viewBox="0 0 16 16"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
