import { useState } from "react";
import type { Priority } from "../../src/universe/types.ts";
import type { WebCommand } from "../../src/web/protocol.ts";
import { ModalDialog } from "./ModalDialog.tsx";

interface NewGoalDialogProps {
  readonly pending: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onCreate: (command: WebCommand) => Promise<void>;
}

const priorities: readonly Priority[] = ["P0", "P1", "P2", "P3"];

export const NewGoalDialog = ({
  pending,
  error,
  onCancel,
  onCreate,
}: NewGoalDialogProps): React.JSX.Element => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("P2");
  return (
    <ModalDialog ariaLabelledBy="new-goal-title" className="modal-backdrop" onClose={onCancel}>
      <section className="goal-dialog">
        <header>
          <div>
            <p className="overline">NEW SEMANTIC OBJECT</p>
            <h2 id="new-goal-title">Create a goal</h2>
          </div>
          <button aria-label="Close new goal dialog" onClick={onCancel} type="button">
            ×
          </button>
        </header>
        <div className="goal-dialog__body">
          <label>
            <span>Goal title</span>
            <input
              autoFocus
              data-autofocus
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Why this matters and what success looks like"
              rows={5}
              value={description}
            />
          </label>
          <label>
            <span>Priority</span>
            <select
              onChange={(event) =>
                setPriority(
                  priorities.find((candidate) => candidate === event.target.value) ?? "P2",
                )
              }
              value={priority}
            >
              {priorities.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="command-error">{error}</p> : null}
        </div>
        <footer>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            disabled={pending || !title.trim()}
            onClick={() => void onCreate({ type: "CreateGoal", title, description, priority })}
            type="button"
          >
            {pending ? "Creating…" : "Create goal"}
          </button>
        </footer>
      </section>
    </ModalDialog>
  );
};
