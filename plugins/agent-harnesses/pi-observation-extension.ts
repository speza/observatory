import { recordProviderHook } from "./provider-observation-hook.ts";

interface PiContext {
  readonly cwd: string;
  readonly sessionManager: { getSessionId(): string };
}

interface PiEvent {
  readonly type: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly turnIndex?: number;
}

interface PiExtensionApi {
  on(event: string, handler: (event: PiEvent, context: PiContext) => void | Promise<void>): void;
}

const supported = [
  "session_start",
  "before_agent_start",
  "agent_start",
  "agent_settled",
  "tool_execution_start",
  "tool_execution_end",
  "session_before_compact",
  "session_compact",
  "session_shutdown",
] as const;

export interface PiObservationOptions {
  readonly outbox?: string;
  readonly providerRoot?: string;
}

export const createPiObservationExtension =
  (options: PiObservationOptions = {}) =>
  (pi: PiExtensionApi): void => {
    for (const eventName of supported)
      pi.on(eventName, async (event, context) => {
        await recordProviderHook(
          "pi",
          {
            hook_event_name: event.type,
            session_id: context.sessionManager.getSessionId(),
            tool_call_id: event.toolCallId,
            tool_name: event.toolName,
            turn_index: event.turnIndex,
          },
          options,
        );
      });
  };

export default createPiObservationExtension();
