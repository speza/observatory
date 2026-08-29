import type { HostAgentObservation } from "../hosts/types.ts";

export interface ProviderExecutionContext {
  readonly harnessId?: string;
  readonly workspaceRef?: string;
}

const normalizedWorkspace = (value: string | undefined): string | undefined => {
  const normalized = value?.trim().replaceAll(/\\/gu, "/").replace(/\/+$/u, "");
  return normalized || undefined;
};

/**
 * Returns candidate evidence only. A shared harness/workspace must block a
 * duplicate launch, but it never proves that the execution owns a particular
 * provider conversation.
 */
export const isPlausibleUnidentifiedExecution = (
  context: ProviderExecutionContext,
  observation: HostAgentObservation,
): boolean => {
  const harnessId = context.harnessId?.trim();
  const workspaceRef = normalizedWorkspace(context.workspaceRef);
  if (!harnessId || !workspaceRef || observation.harnessEvidence?.nativeConversationRef)
    return false;
  return (
    observation.harnessEvidence?.detectedHarnessId === harnessId &&
    normalizedWorkspace(observation.worktree) === workspaceRef
  );
};
