import { Schema } from "effect";
import {
  defaultObservationOutbox,
  defaultProviderRoot,
  type ProviderHarnessId,
} from "./provider-observation-installation.ts";
import {
  ProviderObservationJournal,
  type ProviderLifecycleEvent,
} from "./provider-observation-journal.ts";

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

const normalized = (value: string | undefined): string | undefined => value?.trim() || undefined;

const normalizeProviderEvent = (
  harnessId: ProviderHarnessId,
  input: ProviderHookInput,
): ProviderLifecycleEvent | undefined => {
  const name = normalized(input.hook_event_name) ?? normalized(input.type);
  const sessionId = normalized(input.session_id) ?? normalized(input.sessionId);
  if (!name || !sessionId) return undefined;
  const toolName = normalized(input.tool_name) ?? normalized(input.toolName);
  const turnValue = input.turn_index ?? input.turnIndex;
  const turnId =
    normalized(input.turn_id) ??
    normalized(input.turnId) ??
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

export interface RecordProviderHookOptions {
  readonly outbox?: string;
  readonly providerRoot?: string;
  readonly now?: number;
}

export const recordProviderHook = async (
  harnessId: ProviderHarnessId,
  input: ProviderHookInput,
  options: RecordProviderHookOptions = {},
): Promise<number> => {
  const event = normalizeProviderEvent(harnessId, input);
  if (!event) return 0;
  return new ProviderObservationJournal({
    harnessId,
    path: options.outbox ?? defaultObservationOutbox(harnessId),
    root: options.providerRoot ?? defaultProviderRoot(harnessId),
  }).record(event, options.now);
};
