import type { AgentView } from "../../../src/projection/types.ts";
import { ModalDialog } from "../shared/ModalDialog.tsx";

interface CloseAgentDialogProps {
  readonly agent: AgentView;
  readonly error?: string;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}

export const CloseAgentDialog = ({
  agent,
  error,
  pending,
  onCancel,
  onConfirm,
}: CloseAgentDialogProps): React.JSX.Element => (
  <ModalDialog ariaLabelledBy="close-agent-title" className="modal-backdrop" onClose={onCancel}>
    <section className="goal-dialog close-agent-dialog">
      <header>
        <div>
          <p className="overline">AGENT LIFECYCLE</p>
          <h2 id="close-agent-title">Close &amp; archive?</h2>
        </div>
        <button aria-label="Close agent dialog" disabled={pending} onClick={onCancel} type="button">
          ×
        </button>
      </header>
      <div className="goal-dialog__body">
        <p>
          Stop <strong>{agent.displayName}</strong> in the host and archive its Observatory record?
        </p>
        <p className="close-agent-dialog__warning">
          {agent.runtimeState === "done"
            ? "Runtime done is not verification. Review any outstanding changes before closing."
            : `This Agent is currently ${agent.runtimeState.replace("-", " ")}. Its running process will be stopped.`}
        </p>
        {error ? <p className="command-error">{error}</p> : null}
      </div>
      <footer>
        <button disabled={pending} onClick={onCancel} type="button">
          Cancel
        </button>
        <button data-autofocus disabled={pending} onClick={() => void onConfirm()} type="button">
          {pending ? "Closing…" : "Close & archive"}
        </button>
      </footer>
    </section>
  </ModalDialog>
);
