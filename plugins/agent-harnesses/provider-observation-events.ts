import { Schema } from "effect";
import type { AgentObservationReceiverInput } from "../../src/plugin-sdk/index.ts";
import type { ProviderHarnessId } from "./provider-observation-installation.ts";

export const ProviderHookInputSchema = Schema.Struct({
  hook_event_name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  sessionId: Schema.optional(Schema.String),
  tool_name: Schema.optional(Schema.String),
  toolName: Schema.optional(Schema.String),
  turn_id: Schema.optional(Schema.String),
  turnId: Schema.optional(Schema.String),
  turn_index: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  turnIndex: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
});
export type ProviderHookInput = typeof ProviderHookInputSchema.Type;

export type ProviderLifecycleEvent =
  | { readonly type: "session-started"; readonly sessionId: string }
  | { readonly type: "turn-started"; readonly sessionId: string; readonly turnId?: string }
  | { readonly type: "tool-started"; readonly sessionId: string; readonly toolName?: string }
  | { readonly type: "tool-completed"; readonly sessionId: string; readonly toolName?: string }
  | {
      readonly type: "permission-requested";
      readonly sessionId: string;
      readonly toolName?: string;
    }
  | { readonly type: "compaction-started"; readonly sessionId: string }
  | { readonly type: "compaction-completed"; readonly sessionId: string }
  | { readonly type: "settled"; readonly sessionId: string; readonly turnId?: string }
  | { readonly type: "session-ended"; readonly sessionId: string };

const normalized = (value: string | undefined): string | undefined => value?.trim() || undefined;

export const decodeProviderHookEvent = (
  harnessId: ProviderHarnessId,
  input: AgentObservationReceiverInput,
): ProviderLifecycleEvent | undefined => {
  const decoded = Schema.decodeUnknownSync(ProviderHookInputSchema)(input);
  const name = normalized(decoded.hook_event_name) ?? normalized(decoded.type);
  const sessionId = normalized(decoded.session_id) ?? normalized(decoded.sessionId);
  if (!name || !sessionId || sessionId.length > 1_000) return undefined;
  const toolName = normalized(decoded.tool_name) ?? normalized(decoded.toolName);
  const turnValue = decoded.turn_index ?? decoded.turnIndex;
  const turnId =
    normalized(decoded.turn_id) ??
    normalized(decoded.turnId) ??
    (turnValue === undefined ? undefined : normalized(String(turnValue)));
  const event = (type: ProviderLifecycleEvent["type"]): ProviderLifecycleEvent => ({
    type,
    sessionId,
    toolName,
    turnId,
  });

  if (harnessId !== "pi") {
    if (name === "SessionStart") return event("session-started");
    if (name === "UserPromptSubmit") return event("turn-started");
    if (name === "PreToolUse") return event("tool-started");
    if (name === "PermissionRequest") return event("permission-requested");
    if (name === "PostToolUse" || name === "PostToolUseFailure") return event("tool-completed");
    if (name === "PreCompact") return event("compaction-started");
    if (name === "PostCompact") return event("compaction-completed");
    if (name === "Stop" || name === "SubagentStop") return event("settled");
    if (name === "SessionEnd") return event("session-ended");
    return undefined;
  }
  if (name === "session_start") return event("session-started");
  if (name === "before_agent_start" || name === "agent_start") return event("turn-started");
  if (name === "tool_execution_start") return event("tool-started");
  if (name === "tool_execution_end") return event("tool-completed");
  if (name === "session_before_compact") return event("compaction-started");
  if (name === "session_compact") return event("compaction-completed");
  if (name === "agent_settled") return event("settled");
  if (name === "session_shutdown") return event("session-ended");
  return undefined;
};
