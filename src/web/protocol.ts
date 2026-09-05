import type { CommandResult } from "../universe/universe.ts";
import type { Priority } from "../universe/types.ts";
import type { LinkedExecution } from "../hosts/types.ts";
import type { AgentHarnessDescriptor } from "../plugin-sdk/index.ts";
import type {
  WorkspaceBrowser,
  WorkspaceChoice,
  WorkspaceDiffSnapshot,
  WorkspaceReviewFileSnapshot,
  WorkspaceReviewSnapshot,
  WorkspaceSelection,
} from "../workspaces/types.ts";
import type { StartAgentResult } from "../session-launch/types.ts";
import type { AgentCloseoutBatchResult } from "../agent-closeout/types.ts";
import type { AgentRepositoryStatusSnapshot } from "../repositories/types.ts";
import type { PluginStatus } from "../plugins/registry.ts";
import type { PortfolioResponse } from "./portfolio.ts";
import type { ConversationHistoryView } from "../conversations/types.ts";

export type WebCommand =
  | {
      readonly type: "CreateSystem";
      readonly title: string;
      readonly description?: string;
    }
  | { readonly type: "RenameSystem"; readonly systemId: string; readonly title: string }
  | {
      readonly type: "SetSystemDescription";
      readonly systemId: string;
      readonly description?: string;
    }
  | {
      readonly type: "CreateGoal";
      readonly title: string;
      readonly description?: string;
      readonly priority: Priority;
      readonly systemId?: string;
    }
  | { readonly type: "RenameGoal"; readonly goalId: string; readonly title: string }
  | {
      readonly type: "SetGoalDescription";
      readonly goalId: string;
      readonly description?: string;
    }
  | { readonly type: "SetGoalPriority"; readonly goalId: string; readonly priority: Priority }
  | {
      readonly type: "SetGoalMapPosition";
      readonly goalId: string;
      readonly position: { readonly x: number; readonly y: number };
    }
  | { readonly type: "ResetGoalMapPosition"; readonly goalId: string }
  | { readonly type: "AssignGoalToSystem"; readonly goalId: string; readonly systemId?: string }
  | { readonly type: "AssignAgent"; readonly agentId: string; readonly goalId: string }
  | { readonly type: "AssignAgents"; readonly agentIds: readonly string[]; readonly goalId: string }
  | { readonly type: "UnassignAgent"; readonly agentId: string }
  | { readonly type: "ArchiveAgent"; readonly agentId: string }
  | { readonly type: "ArchiveAgents"; readonly agentIds: readonly string[] }
  | { readonly type: "CompleteGoal"; readonly goalId: string }
  | { readonly type: "ArchiveGoal"; readonly goalId: string }
  | {
      readonly type: "AcknowledgeCatchUp";
      readonly throughSequence: number;
      readonly evidenceThroughSequence: number;
    };

export interface WebCommandResponse {
  readonly result: CommandResult;
  readonly portfolio: PortfolioResponse;
}

export interface WebCloseoutRequest {
  readonly agentIds: readonly string[];
}

export interface WebCloseoutResponse {
  readonly result: AgentCloseoutBatchResult;
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
  readonly agents: readonly AgentHarnessDescriptor[];
}

export interface WebWorkspaceBrowserResponse extends WorkspaceBrowser {
  readonly kind: "workspace-browser";
}

export interface WebStartAgentRequest {
  readonly requestId: string;
  readonly goalId?: string;
  readonly workspace: WorkspaceSelection;
  readonly harnessId: string;
  readonly agentName?: string;
  readonly prompt?: string;
}

export interface WebStartAgentResponse {
  readonly result: StartAgentResult;
  readonly portfolio: PortfolioResponse;
  readonly pendingLaunch?: WebPendingLaunch;
}

export interface WebPendingLaunch {
  readonly requestId: string;
  readonly harnessId: string;
  readonly displayName: string;
  readonly goalId?: string;
  readonly message: string;
}

export interface WebPendingLaunchesResponse {
  readonly kind: "pending-launches";
  readonly launches: readonly WebPendingLaunch[];
}

export interface RendererSubject {
  readonly type: "system" | "goal" | "agent";
  readonly id: string;
}

export interface BrowserProjectionSnapshot {
  readonly kind: "snapshot";
  readonly epoch: string;
  readonly revision: number;
  readonly generatedAt: number;
  readonly portfolio: PortfolioResponse;
  readonly pendingLaunches: readonly WebPendingLaunch[];
  readonly affected: readonly RendererSubject[];
  readonly affectedAll: boolean;
}

export type BrowserProjectionEvent =
  | BrowserProjectionSnapshot
  | {
      readonly kind: "portfolio-replaced";
      readonly epoch: string;
      readonly revision: number;
      readonly generatedAt: number;
      readonly portfolio: PortfolioResponse;
      readonly affected: readonly RendererSubject[];
      readonly affectedAll: boolean;
    }
  | {
      readonly kind: "pending-launches-replaced";
      readonly epoch: string;
      readonly revision: number;
      readonly generatedAt: number;
      readonly pendingLaunches: readonly WebPendingLaunch[];
      readonly affected: readonly RendererSubject[];
      readonly affectedAll: boolean;
    };

export interface WebResumeAgentRequest {
  readonly requestId: string;
  readonly agentId: string;
  readonly prompt?: string;
}

export type WebResumeAgentResponse = WebStartAgentResponse;

export interface WebWorkspaceReviewResponse extends Omit<WorkspaceReviewSnapshot, "changes"> {
  readonly agentId: string;
  readonly agentName: string;
  readonly goalTitle?: string;
  readonly changes: Omit<WorkspaceDiffSnapshot, "worktree">;
}

export type WebWorkspaceReviewFileResponse = WorkspaceReviewFileSnapshot;

export type WebAgentRepositoryStatusResponse = AgentRepositoryStatusSnapshot;

export interface WebPluginStatusResponse {
  readonly kind: "plugin-status";
  readonly plugins: readonly PluginStatus[];
}

export interface WebConversationHistoryResponse {
  readonly kind: "conversation-history";
  readonly conversations: readonly ConversationHistoryView[];
}

export interface WebAddConversationResponse {
  readonly agentId: string;
  readonly goalId?: string;
  readonly portfolio: PortfolioResponse;
}

export interface WebTerminalOpenResponse {
  readonly sessionId: string;
  readonly message: string;
}

export type WebTerminalClientMessage =
  | { readonly kind: "input"; readonly value: string }
  | { readonly kind: "bytes"; readonly bytes: readonly number[] }
  | ({ readonly kind: "scroll" } & WebTerminalScrollRequest)
  | {
      readonly kind: "resize";
      readonly columns: number;
      readonly rows: number;
    };

export type WebTerminalServerMessage =
  | WebTerminalEvent
  | { readonly kind: "error"; readonly message: string };

/** Bounded generously enough for full-screen terminals on modern high-resolution displays. */
export const WEB_TERMINAL_DIMENSION_LIMITS = {
  minColumns: 1,
  maxColumns: 1_000,
  minRows: 1,
  maxRows: 500,
} as const;

export interface WebTerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

const boundedTerminalDimension = (value: number, minimum: number, maximum: number): number => {
  const integer = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
};

/** Keep the browser grid and host PTY on the same safe dimensions at any viewport size. */
export const boundWebTerminalDimensions = (
  dimensions: WebTerminalDimensions,
): WebTerminalDimensions => ({
  columns: boundedTerminalDimension(
    dimensions.columns,
    WEB_TERMINAL_DIMENSION_LIMITS.minColumns,
    WEB_TERMINAL_DIMENSION_LIMITS.maxColumns,
  ),
  rows: boundedTerminalDimension(
    dimensions.rows,
    WEB_TERMINAL_DIMENSION_LIMITS.minRows,
    WEB_TERMINAL_DIMENSION_LIMITS.maxRows,
  ),
});

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
      readonly deliveryId: number;
      readonly bytes: string;
      readonly columns?: number;
      readonly rows?: number;
      readonly sequence?: number;
      readonly full?: boolean;
    }
  | { readonly kind: "closed"; readonly deliveryId?: number; readonly reason?: string };
