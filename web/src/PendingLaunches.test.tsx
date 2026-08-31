import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingLaunches } from "./PendingLaunches.tsx";

test("a pending launch can be opened or dismissed", () => {
  const markup = renderToStaticMarkup(
    <PendingLaunches
      launches={[
        {
          requestId: "web-launch-test",
          harnessId: "codex",
          displayName: "Codex agent",
          message: "Waiting for continuity evidence.",
        },
      ]}
      onDismiss={() => undefined}
      onOpen={() => undefined}
    />,
  );

  expect(markup).toContain("Codex agent · open terminal");
  expect(markup).toContain('aria-label="Dismiss Codex agent pending launch"');
});
