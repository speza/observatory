import type { Effect, Stream } from "effect";
import type { RuntimeState } from "../universe/types.ts";
import type { HostError } from "./errors.ts";

/** Convert an opaque host kind into a readable label without knowing a host's brand. */
export const displayHostKind = (hostKind: string): string => {
  const normalized = hostKind.trim().replace(/[-_]+/g, " ");
  if (!normalized) return "Host";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
};

export interface HostSessionObservation {
  readonly nativeId: string;
  readonly displayName: string;
  readonly runtimeState: RuntimeState;
  readonly runtimeStateSource: string;
  readonly observedAt: number;
  readonly repository?: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly provider?: string;
  /** Serialized and opaque outside the session-host adapter. */
  readonly hostLocator: string;
}

export interface HostSnapshot {
  readonly hostKind: string;
  readonly available: boolean;
  readonly observedAt: number;
  readonly sessions: readonly HostSessionObservation[];
  readonly diagnostics: readonly string[];
  readonly error?: string;
}

export interface OpaqueAccessTarget {
  readonly kind: string;
  readonly token: string;
}

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface HostTerminalFrame {
  readonly bytes: Uint8Array;
  readonly columns?: number;
  readonly rows?: number;
  readonly sequence?: number;
  readonly full?: boolean;
}

export type HostTerminalEvent =
  | { readonly kind: "frame"; readonly frame: HostTerminalFrame }
  | { readonly kind: "closed"; readonly reason?: string };

export type HostTerminalInput =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "bytes"; readonly value: Uint8Array };

/** A host-owned terminal stream. The host owns the process and its lifecycle. */
export interface HostedTerminalSession {
  readonly events: Stream.Stream<HostTerminalEvent, HostError>;
  send(input: HostTerminalInput): Effect.Effect<HostActionResult, HostError>;
  resize(dimensions: TerminalDimensions): Effect.Effect<HostActionResult, HostError>;
  release(): Effect.Effect<HostActionResult, HostError>;
}

export interface HostTerminalOpenResult {
  readonly ok: boolean;
  readonly message: string;
  readonly terminal?: HostedTerminalSession;
}

export interface SessionAccess {
  readonly supported: boolean;
  readonly mode?: "focus" | "attach";
  readonly target?: OpaqueAccessTarget;
  /** Optional host-owned terminal capability for this session. */
  readonly terminalTarget?: OpaqueAccessTarget;
  readonly explanation: string;
}

export interface HostActionResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface SessionHost {
  snapshot(): Effect.Effect<HostSnapshot, HostError>;
  access(session: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Effect.Effect<SessionAccess, HostError>;
  activate(access: SessionAccess): Effect.Effect<HostActionResult, HostError>;
  openTerminal(
    access: SessionAccess,
    dimensions: TerminalDimensions,
  ): Effect.Effect<HostTerminalOpenResult, HostError>;
}
