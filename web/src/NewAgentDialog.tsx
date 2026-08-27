import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WebLaunchOptionsResponse,
  WebStartAgentRequest,
  WebStartAgentResponse,
  WebWorkspaceBrowserResponse,
} from "../../src/web/protocol.ts";
import { browseLaunchWorkspace, fetchLaunchOptions, startWebAgent } from "./api.ts";
import { ModalDialog } from "./ModalDialog.tsx";

interface NewAgentDialogProps {
  readonly defaultGoalId?: string;
  readonly onCancel: () => void;
  readonly onStarted: (response: WebStartAgentResponse) => void;
}

export const NewAgentDialog = ({
  defaultGoalId,
  onCancel,
  onStarted,
}: NewAgentDialogProps): React.JSX.Element => {
  const [options, setOptions] = useState<WebLaunchOptionsResponse>();
  const [goalId, setGoalId] = useState(defaultGoalId ?? "");
  const [location, setLocation] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<"existing" | "worktree">("existing");
  const [branch, setBranch] = useState("feat/observatory-agent");
  const [agentKind, setAgentKind] = useState("");
  const [agentName, setAgentName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [browser, setBrowser] = useState<WebWorkspaceBrowserResponse>();
  const [browserLoading, setBrowserLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const browseRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void fetchLaunchOptions(controller.signal)
      .then((result) => {
        setOptions(result);
        setLocation(result.locations.find((choice) => choice.available)?.path ?? "");
        setAgentKind(
          result.agents.find((agent) => agent.kind === "codex")?.kind ??
            result.agents[0]?.kind ??
            "",
        );
        if (defaultGoalId && !result.goals.some((goal) => goal.id === defaultGoalId)) setGoalId("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Launch choices are unavailable.");
      });
    return () => controller.abort();
  }, [defaultGoalId]);

  useEffect(() => () => browseRequest.current?.abort(), []);

  const selectedAgent = useMemo(
    () => options?.agents.find((agent) => agent.kind === agentKind),
    [agentKind, options?.agents],
  );

  const browse = async (path: string): Promise<void> => {
    browseRequest.current?.abort();
    const controller = new AbortController();
    browseRequest.current = controller;
    setBrowserLoading(true);
    setError(undefined);
    try {
      const result = await browseLaunchWorkspace(path, controller.signal);
      if (!controller.signal.aborted && browseRequest.current === controller) setBrowser(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "Workspace could not be browsed.");
    } finally {
      if (browseRequest.current === controller) {
        browseRequest.current = undefined;
        setBrowserLoading(false);
      }
    }
  };

  const submit = async (): Promise<void> => {
    const cleanLocation = location.trim();
    if (!cleanLocation || !agentKind) return;
    if (workspaceMode === "worktree" && !branch.trim()) {
      setError("A branch name is required for a new worktree.");
      return;
    }
    setPending(true);
    setError(undefined);
    const request: WebStartAgentRequest = {
      requestId: `web-launch-${crypto.randomUUID()}`,
      goalId: goalId || undefined,
      workspace:
        workspaceMode === "worktree"
          ? { kind: "worktree", repositoryPath: cleanLocation, branch: branch.trim() }
          : { kind: "existing", path: cleanLocation },
      agentKind,
      agentName: agentName.trim() || undefined,
      prompt: prompt.trim() || undefined,
    };
    try {
      onStarted(await startWebAgent(request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Agent launch failed.");
      setPending(false);
    }
  };

  return (
    <ModalDialog ariaLabelledBy="new-agent-title" className="modal-backdrop" onClose={onCancel}>
      <section className="goal-dialog agent-dialog">
        <header>
          <div>
            <p className="overline">NEW HOSTED SESSION</p>
            <h2 id="new-agent-title">Start an agent</h2>
          </div>
          <button aria-label="Close new agent dialog" onClick={onCancel} type="button">
            ×
          </button>
        </header>
        <div className="goal-dialog__body">
          <label>
            <span>Goal</span>
            <select onChange={(event) => setGoalId(event.target.value)} value={goalId}>
              <option value="">Inbox / assign later</option>
              {options?.goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.priority} · {goal.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Location</span>
            <div className="agent-dialog__location">
              <input
                autoFocus
                data-autofocus
                list="launch-locations"
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Choose or enter a directory"
                value={location}
              />
              <button
                disabled={browserLoading || !location.trim()}
                onClick={() => void browse(location)}
                type="button"
              >
                {browserLoading ? "Browsing…" : "Browse"}
              </button>
            </div>
            <datalist id="launch-locations">
              {options?.locations
                .filter((choice) => choice.available)
                .map((choice) => (
                  <option key={choice.path} value={choice.path}>
                    {choice.label}
                  </option>
                ))}
            </datalist>
          </label>
          {browser ? (
            <div className="agent-dialog__browser">
              <div>
                <button
                  disabled={!browser.parentPath}
                  onClick={() => {
                    if (browser.parentPath) void browse(browser.parentPath);
                  }}
                  type="button"
                >
                  Parent
                </button>
                <button
                  onClick={() => {
                    setLocation(browser.path);
                    setBrowser(undefined);
                  }}
                  type="button"
                >
                  Use this folder
                </button>
              </div>
              <small>{browser.path}</small>
              <ul>
                {browser.entries.map((entry) => (
                  <li key={entry.path}>
                    <button onClick={() => void browse(entry.path)} type="button">
                      {entry.label}
                      {entry.repository ? <small>{entry.repository}</small> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <fieldset className="agent-dialog__mode">
            <legend>Workspace</legend>
            <label>
              <input
                checked={workspaceMode === "existing"}
                name="workspace-mode"
                onChange={() => setWorkspaceMode("existing")}
                type="radio"
              />
              Existing checkout
            </label>
            <label>
              <input
                checked={workspaceMode === "worktree"}
                name="workspace-mode"
                onChange={() => setWorkspaceMode("worktree")}
                type="radio"
              />
              New worktree
            </label>
          </fieldset>
          {workspaceMode === "worktree" ? (
            <label>
              <span>New branch</span>
              <input onChange={(event) => setBranch(event.target.value)} value={branch} />
            </label>
          ) : null}
          <label>
            <span>Agent</span>
            <select onChange={(event) => setAgentKind(event.target.value)} value={agentKind}>
              {options?.agents.map((agent) => (
                <option key={agent.kind} value={agent.kind}>
                  {agent.label}
                </option>
              ))}
            </select>
            {selectedAgent?.description ? <small>{selectedAgent.description}</small> : null}
          </label>
          <label>
            <span>Name (optional)</span>
            <input onChange={(event) => setAgentName(event.target.value)} value={agentName} />
          </label>
          <label>
            <span>Initial prompt (optional)</span>
            <textarea onChange={(event) => setPrompt(event.target.value)} rows={4} value={prompt} />
          </label>
          {error ? <p className="command-error">{error}</p> : null}
        </div>
        <footer>
          <button onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            disabled={pending || !options || !location.trim() || !agentKind}
            onClick={() => void submit()}
            type="button"
          >
            {pending ? "Starting…" : "Start agent"}
          </button>
        </footer>
      </section>
    </ModalDialog>
  );
};
