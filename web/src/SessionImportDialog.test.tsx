import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionImportDialog } from "./SessionImportDialog.tsx";

describe("SessionImportDialog", () => {
  test("presents a compact import catalogue and blocks ambiguous resume", () => {
    const markup = renderToStaticMarkup(
      <SessionImportDialog
        error={undefined}
        goals={[]}
        onClose={() => {}}
        onImport={async () => ({ agentId: "agent-1" })}
        onImported={() => {}}
        onRefresh={async () => {}}
        pending={false}
        sessions={[
          {
            handle: "opaque-handle",
            harnessId: "codex",
            providerLabel: "Codex",
            title: "Regression work",
            workspaceRef: "/synthetic/project",
            resumeEligibility: "same-site",
            provenance: "provider-index",
            executionState: "possibly-live",
          },
        ]}
      />,
    );

    expect(markup).toContain("Session import");
    expect(markup).toContain("Regression work");
    expect(markup).toContain("Possibly running");
    expect(markup).toContain("Search");
    expect(markup).toContain("All providers");
    expect(markup).toContain("Destination Goal");
    expect(markup).toContain("Add to goal");
    expect(markup).toContain("Import unassigned");
    expect(markup).toContain("The Agent will appear in Inbox.");
    expect(markup).toContain("A plausible live execution must be resolved before resuming.");
    expect(markup).not.toContain("opaque-handle");
  });
});
