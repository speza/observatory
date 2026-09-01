import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ObservatoryLogo } from "./ObservatoryLogo.tsx";

test("ObservatoryLogo renders the aperture, datum, and signal mark", () => {
  const markup = renderToStaticMarkup(<ObservatoryLogo className="brandmark" />);

  expect(markup).toContain('class="observatory-logo brandmark"');
  expect(markup).toContain('class="observatory-logo__aperture"');
  expect(markup).toContain('class="observatory-logo__datum"');
  expect(markup).toContain('class="observatory-logo__signal"');
  expect(markup).toContain('aria-hidden="true"');
});
