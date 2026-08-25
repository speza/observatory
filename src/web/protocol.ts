import type { CommandResult } from "../universe/universe.ts";
import type { Priority } from "../universe/types.ts";
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

export interface WebTerminalOpenResponse {
  readonly sessionId: string;
  readonly message: string;
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
