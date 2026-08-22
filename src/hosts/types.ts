import type { RuntimeState } from "../universe/types.ts";

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

export interface SessionAccess {
  readonly supported: boolean;
  readonly mode?: "focus" | "attach";
  readonly target?: OpaqueAccessTarget;
  readonly explanation: string;
}

export interface HostActionResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface SessionHost {
  snapshot(): Promise<HostSnapshot>;
  access(session: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Promise<SessionAccess>;
  activate(access: SessionAccess): Promise<HostActionResult>;
}
