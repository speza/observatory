import type { Effect } from "effect";
import type { ControlPlaneEventSink } from "../control-plane-events/index.ts";
import type { HostSnapshot, SessionHost } from "../hosts/types.ts";
import type { AgentHarness, OpaqueNativeConversationRef } from "../plugin-sdk/index.ts";
import type { ReconciliationResult, Universe } from "../universe/universe.ts";
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
  readonly harness: {
    readonly id: string;
    readonly name?: string;
    readonly args?: readonly string[];
  };
  readonly prompt?: string;
  readonly agentName?: string;
  readonly mode?: "manual" | "auto" | "hybrid";
}

export interface ResumeAgentIntent {
  readonly requestId: string;
  readonly agentId: AgentId;
  readonly args?: readonly string[];
  readonly prompt?: string;
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

export interface LaunchReceipt {
  readonly requestId: string;
  readonly intentFingerprint: string;
  readonly result: StartAgentResult;
  readonly recovery?: LaunchRecovery;
}

export interface LaunchRecovery {
  readonly kind: "start" | "resume";
  readonly harnessId: string;
  readonly executionRef: string;
  readonly displayName?: string;
  readonly nativeConversationRef?: OpaqueNativeConversationRef;
  readonly goalId?: GoalId;
  readonly agentId?: AgentId;
}

export interface LaunchReceiptStore {
  launchReceipts(): readonly LaunchReceipt[];
  reserveLaunchReceipt(
    receipt: LaunchReceipt,
  ):
    | { readonly kind: "reserved" }
    | { readonly kind: "existing"; readonly receipt: LaunchReceipt }
    | { readonly kind: "conflict" };
  saveLaunchReceipt(receipt: LaunchReceipt): void;
}

export interface PendingLaunch {
  readonly requestId: string;
  readonly harnessId: string;
  readonly executionRef: string;
  readonly displayName: string;
  readonly goalId?: GoalId;
  readonly message: string;
}

export interface StartAgentCoordinator {
  start(intent: StartAgentIntent): Effect.Effect<StartAgentResult, LaunchError>;
  resume(intent: ResumeAgentIntent): Effect.Effect<StartAgentResult, LaunchError>;
  pendingLaunches(): readonly PendingLaunch[];
  refreshPending(): Effect.Effect<readonly StartAgentResult[], LaunchError>;
}

export interface AgentHarnessRegistry {
  agentHarness(harnessId: string): AgentHarness | undefined;
}

export interface StartAgentCoordinatorOptions {
  readonly universe: Universe;
  readonly host: SessionHost;
  readonly harnesses: AgentHarnessRegistry;
  readonly workspace: WorkspaceProvider;
  readonly receipts?: LaunchReceiptStore;
  readonly reconcileHost?: (snapshot: HostSnapshot) => ReconciliationResult;
  readonly events?: ControlPlaneEventSink;
  readonly now?: () => number;
}
