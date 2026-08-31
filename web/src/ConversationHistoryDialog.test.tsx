import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationHistoryDialog } from "./ConversationHistoryDialog.tsx";

describe("ConversationHistoryDialog", () => {
  test("presents a compact dormant-conversation catalogue", () => {
    const markup = renderToStaticMarkup(
      <ConversationHistoryDialog
        conversations={[
          {
            handle: "opaque-handle",
            harnessId: "codex",
            providerLabel: "Codex",
            title: "Regression work",
            workspaceRef: "/synthetic/project",
            resumeEligibility: "same-site",
            provenance: "provider-index",
            runtimeState: "dormant",
          },
        ]}
        error={undefined}
        goals={[]}
        onAdd={async () => ({ agentId: "agent-1" })}
        onAdded={() => {}}
        onClose={() => {}}
        onRefresh={async () => {}}
        pending={false}
      />,
    );

    expect(markup).toContain("Conversation history");
    expect(markup).toContain("Regression work");
    expect(markup).toContain("Dormant · resumable");
    expect(markup).toContain("Search");
    expect(markup).toContain("All providers");
    expect(markup).toContain("Destination Goal");
    expect(markup).toContain("Add to goal");
    expect(markup).toContain("Add unassigned");
    expect(markup).toContain("The Agent will appear in Inbox.");
    expect(markup).not.toContain("opaque-handle");
  });
});
