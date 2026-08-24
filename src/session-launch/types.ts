import type { Effect } from "effect";
import type { SessionHost } from "../hosts/types.ts";
import type { HostError } from "../hosts/errors.ts";
import type { Universe } from "../universe/universe.ts";
import type { GoalId, AgentId } from "../universe/types.ts";
import type {
  PreparedWorkspace,
  WorkspaceProvider,
  WorkspaceSelection,
} from "../workspaces/types.ts";

export interface LaunchError {
  readonly _tag: "LaunchError";
  readonly operation: string;
  readonly message: string;
}

export const launchError = (operation: string, message: string): LaunchError => ({
  _tag: "LaunchError",
  operation,
  message,
});

export type LaunchGoal =
  | { readonly kind: "goal"; readonly goalId: GoalId }
  | {
      readonly kind: "new-goal";
      readonly title: string;
      readonly description?: string;
    }
  | { readonly kind: "inbox" };

export interface StartAgentIntent {
  readonly requestId: string;
  readonly goal: LaunchGoal;
  readonly workspace: WorkspaceSelection;
  readonly agent: {
    readonly kind: string;
    readonly name?: string;
    readonly args?: readonly string[];
  };
  readonly prompt?: string;
  readonly agentName?: string;
  readonly mode?: "manual" | "auto" | "hybrid";
}

export interface StartAgentResult {
  readonly status: "started" | "already-observed" | "pending" | "failed";
  readonly message: string;
  readonly requestId: string;
  readonly goalId?: GoalId;
  readonly agentId?: AgentId;
  readonly workspace?: PreparedWorkspace;
  readonly warnings?: readonly string[];
}

export interface StartAgentCoordinator {
  start(intent: StartAgentIntent): Effect.Effect<StartAgentResult, LaunchError>;
}

export interface StartAgentCoordinatorOptions {
  readonly universe: Universe;
  readonly host: SessionHost;
  readonly workspace: WorkspaceProvider;
  readonly refresh: Effect.Effect<string, HostError>;
}
