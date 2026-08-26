import type { CommandResult } from "../universe/universe.ts";
import type { Priority } from "../universe/types.ts";
import type { HostLaunchOption, LinkedExecution } from "../hosts/types.ts";
import type {
  WorkspaceBrowser,
  WorkspaceChoice,
  WorkspaceDiffSnapshot,
  WorkspaceSelection,
} from "../workspaces/types.ts";
import type { StartAgentResult } from "../session-launch/types.ts";
import type { PortfolioResponse } from "./api.ts";

export type WebCommand =
  | {
      readonly type: "CreateGoal";
      readonly title: string;
      readonly description?: string;
      readonly priority: Priority;
    }
  | { readonly type: "RenameGoal"; readonly goalId: string; readonly title: string }
  | {
      readonly type: "SetGoalDescription";
      readonly goalId: string;
      readonly description?: string;
    }
  | { readonly type: "SetGoalPriority"; readonly goalId: string; readonly priority: Priority }
  | { readonly type: "AssignAgent"; readonly agentId: string; readonly goalId: string }
  | { readonly type: "UnassignAgent"; readonly agentId: string }
  | { readonly type: "ArchiveAgent"; readonly agentId: string }
  | { readonly type: "CompleteGoal"; readonly goalId: string }
  | { readonly type: "ArchiveGoal"; readonly goalId: string }
  | { readonly type: "AcknowledgeCatchUp" };

export interface WebCommandResponse {
  readonly result: CommandResult;
  readonly portfolio: PortfolioResponse;
}

export interface WebLaunchGoal {
  readonly id: string;
  readonly title: string;
  readonly priority: Priority;
}

export interface WebLaunchOptionsResponse {
  readonly kind: "launch-options";
  readonly goals: readonly WebLaunchGoal[];
  readonly locations: readonly WorkspaceChoice[];
  readonly agents: readonly HostLaunchOption[];
}

export interface WebWorkspaceBrowserResponse extends WorkspaceBrowser {
  readonly kind: "workspace-browser";
}

export interface WebStartAgentRequest {
  readonly requestId: string;
  readonly goalId?: string;
  readonly workspace: WorkspaceSelection;
  readonly agentKind: string;
  readonly agentName?: string;
  readonly prompt?: string;
}

export interface WebStartAgentResponse {
  readonly result: StartAgentResult;
  readonly portfolio: PortfolioResponse;
}

export interface WebWorkingTreeDiffResponse extends WorkspaceDiffSnapshot {
  readonly agentId: string;
  readonly agentName: string;
  readonly goalTitle?: string;
}

export interface WebTerminalOpenResponse {
  readonly sessionId: string;
  readonly message: string;
}

/** A browser-safe handle for a host-provided companion terminal. */
export interface WebTerminalLink {
  /** Opaque to the browser; the server resolves it back to a LinkedExecution. */
  readonly id: string;
  readonly kind: LinkedExecution["kind"];
  readonly label: string;
  readonly source: LinkedExecution["source"];
  readonly available: boolean;
  readonly explanation: string;
}

export interface WebTerminalLinksResponse {
  readonly kind: "terminal-links";
  readonly agentId: string;
  readonly agentName: string;
  readonly links: readonly WebTerminalLink[];
  readonly message?: string;
}

export interface WebTerminalActionResponse {
  readonly ok: true;
  readonly message: string;
}

export interface WebTerminalScrollRequest {
  readonly direction: "up" | "down";
  readonly lines: number;
  readonly source: "wheel" | "page-key";
}

export type WebTerminalEvent =
  | {
      readonly kind: "frame";
      readonly bytes: string;
      readonly columns?: number;
      readonly rows?: number;
      readonly sequence?: number;
      readonly full?: boolean;
    }
  | { readonly kind: "closed"; readonly reason?: string };
