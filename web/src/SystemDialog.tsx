import { useState } from "react";
import type { SystemView } from "../../src/projection/types.ts";
import type { WebCommand, WebCommandResponse } from "../../src/web/protocol.ts";
import { ModalDialog } from "./ModalDialog.tsx";

interface SystemDialogProps {
  readonly system?: SystemView;
  readonly pending: boolean;
  readonly error?: string;
  readonly onCancel: () => void;
  readonly onCommand: (command: WebCommand) => Promise<WebCommandResponse | undefined>;
  readonly onSaved: (systemId: string) => void;
}

export const SystemDialog = ({
  system,
  pending,
  error,
  onCancel,
  onCommand,
  onSaved,
}: SystemDialogProps): React.JSX.Element => {
  const [title, setTitle] = useState(system?.title ?? "");
  const [description, setDescription] = useState(system?.description ?? "");

  const save = async (): Promise<void> => {
    if (!system) {
      const response = await onCommand({ type: "CreateSystem", title, description });
      if (response?.result.systemId) onSaved(response.result.systemId);
      return;
    }
    if (title !== system.title) {
      const response = await onCommand({ type: "RenameSystem", systemId: system.id, title });
      if (!response) return;
    }
    if (description !== (system.description ?? "")) {
      const response = await onCommand({
        type: "SetSystemDescription",
        systemId: system.id,
        description,
      });
      if (!response) return;
    }
    onSaved(system.id);
  };

  return (
    <ModalDialog ariaLabelledBy="system-dialog-title" className="modal-backdrop" onClose={onCancel}>
      <section className="goal-dialog">
        <header>
          <div>
            <p className="overline">SYSTEM / DURABLE WORK AREA</p>
            <h2 id="system-dialog-title">{system ? "Edit system" : "Create a system"}</h2>
          </div>
          <button aria-label="Close system dialog" onClick={onCancel} type="button">
            ×
          </button>
        </header>
        <div className="goal-dialog__body">
          <label>
            <span>System name</span>
            <input
              autoFocus
              data-autofocus
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Observatory"
              value={title}
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="The broad area of work this system contains"
              rows={4}
              value={description}
            />
          </label>
          {error ? <p className="command-error">{error}</p> : null}
        </div>
        <footer>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          <button disabled={pending || !title.trim()} onClick={() => void save()} type="button">
            {pending ? "Saving…" : system ? "Save system" : "Create system"}
          </button>
        </footer>
      </section>
    </ModalDialog>
  );
};
