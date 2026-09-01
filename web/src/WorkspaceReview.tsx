import { lazy, Suspense, useState } from "react";
import type { AgentView } from "../../src/projection/types.ts";
import { ModalDialog } from "./ModalDialog.tsx";
import { TerminalDeck } from "./TerminalDeck.tsx";

const WorkingTreeDiff = lazy(() =>
  import("./WorkingTreeDiff.tsx").then(({ WorkingTreeDiff: component }) => ({
    default: component,
  })),
);

type Theme = "light" | "dark";

interface WorkspaceReviewProps {
  readonly agent: AgentView;
  readonly theme: Theme;
  readonly onClose: () => void;
}

export const WorkspaceReview = ({
  agent,
  theme,
  onClose,
}: WorkspaceReviewProps): React.JSX.Element => {
  const [terminalOpen, setTerminalOpen] = useState(false);

  return (
    <ModalDialog
      ariaLabel={`Workspace review for ${agent.displayName}`}
      className="workspace-review-backdrop"
      onClose={onClose}
    >
      <section
        className={`workspace-review${terminalOpen ? " workspace-review--terminal-open" : ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {terminalOpen ? (
          <div className="workspace-review__terminal">
            <TerminalDeck
              agent={agent}
              embedded
              key={agent.id}
              onClose={() => setTerminalOpen(false)}
              theme={theme}
            />
          </div>
        ) : null}
        <div className="workspace-review__diff">
          <Suspense
            fallback={
              <div className="workspace-review__loading" role="status">
                Preparing workspace diff…
              </div>
            }
          >
            <WorkingTreeDiff
              agent={agent}
              embedded
              onClose={onClose}
              onTerminalToggle={() => setTerminalOpen((open) => !open)}
              terminalOpen={terminalOpen}
              theme={theme}
            />
          </Suspense>
        </div>
      </section>
    </ModalDialog>
  );
};
