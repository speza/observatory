import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingLaunchTerminal } from "./PendingLaunchTerminal.tsx";

test("pending launch terminal identifies temporary work without rendering an Agent", () => {
  const markup = renderToStaticMarkup(
    <PendingLaunchTerminal
      launch={{
        requestId: "web-launch-test",
        harnessId: "codex",
        displayName: "Image-assisted task",
        message: "Waiting for the first message.",
      }}
      onClose={() => undefined}
      theme="dark"
    />,
  );

  expect(markup).toContain("STARTING / codex");
  expect(markup).toContain("Image-assisted task");
  expect(markup).not.toContain("Agent ID");
});
