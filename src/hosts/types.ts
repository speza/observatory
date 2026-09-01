import type { Effect, Stream } from "effect";
import type { AgentProcessPlan, OpaqueNativeConversationRef } from "../plugin-sdk/index.ts";
import type { ExecutionContainerRef, RuntimeState } from "../universe/types.ts";
import type { HostError } from "./errors.ts";

/** Convert an opaque host kind into a readable label without knowing a host's brand. */
export const displayHostKind = (hostKind: string): string => {
  const normalized = hostKind.trim().replace(/[-_]+/g, " ");
  if (!normalized) return "Host";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
};

export interface HostAgentObservation {
  readonly nativeId: string;
  readonly displayName: string;
  readonly runtimeState: RuntimeState;
  readonly runtimeStateSource: string;
  readonly observedAt: number;
  readonly repository?: string;
  readonly branch?: string;
  readonly worktree?: string;
  readonly provider?: string;
  readonly harnessEvidence?: HostHarnessEvidence;
  /** Optional host-observed execution context; its identity is opaque to core. */
  readonly executionContainer?: ExecutionContainerRef;
  /** Serialized and opaque outside the agent-host adapter. */
  readonly hostLocator: string;
}

export interface HostHarnessEvidence {
  readonly detectedHarnessId?: string;
  readonly nativeConversationRef?: OpaqueNativeConversationRef;
  readonly restoreState?: "host-restored" | "not-restored" | "unknown";
  readonly source: "native-integration" | "hook" | "process" | "unknown";
  readonly observedAt: number;
}

export interface HostSnapshot {
  readonly hostKind: string;
  /** Stable identity of this concrete host instance within its site. */
  readonly hostInstanceId: string;
  readonly available: boolean;
  /** Whether this snapshot is authoritative for execution absence within this host instance. */
  readonly complete: boolean;
  readonly observedAt: number;
  readonly agents: readonly HostAgentObservation[];
  readonly diagnostics: readonly string[];
  readonly error?: string;
}

export interface OpaqueAccessTarget {
  readonly kind: string;
  readonly token: string;
  /** Adapter-owned binding used to reject a reused host identity. */
  readonly fingerprint?: string;
}

export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

/**
 * Describes how a client wants the host-owned PTY sized when opening it.
 * `fit` preserves the existing renderer behaviour; `preserve` lets a
 * secondary client observe/control a terminal without imposing its viewport
 * dimensions on the host session.
 */
export interface TerminalOpenOptions {
  readonly resizeMode?: "fit" | "preserve";
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
  | { readonly kind: "bytes"; readonly value: Uint8Array }
  | {
      /** Scroll the host-owned viewport without pretending this is agent input. */
      readonly kind: "scroll";
      readonly direction: "up" | "down";
      readonly lines: number;
      readonly source: "wheel" | "page-key";
      readonly column?: number;
      readonly row?: number;
      readonly modifiers?: number;
    };

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

/** A transient host-provided execution surface associated with one agent. */
export interface LinkedExecution {
  readonly kind: "shell" | "agent";
  readonly label: string;
  /** Opaque identity of the parent host agent; only the host adapter interprets it. */
  readonly owner: OpaqueAccessTarget;
  readonly workingDirectory?: string;
  /** Opaque to Observatory; only the selected host adapter may interpret it. */
  readonly target?: OpaqueAccessTarget;
  readonly available: boolean;
  /** `observed` attaches to a host surface; `prepared` creates a fresh surface on every open. */
  readonly source: "observed" | "prepared";
  readonly explanation: string;
}

/** A deliberately small, agent-specific set of interaction surfaces. */
export type AgentCapability =
  | "embedded-terminal"
  | "native-handoff"
  | "linked-terminal"
  | "close-agent";

export interface AgentAccess {
  readonly supported: boolean;
  /** Capabilities proven for this particular agent by the host adapter. */
  readonly capabilities: readonly AgentCapability[];
  readonly mode?: "focus" | "attach";
  readonly target?: OpaqueAccessTarget;
  /** Optional host-owned terminal capability for this agent. */
  readonly terminalTarget?: OpaqueAccessTarget;
  /** Existing surfaces and repeatable host-owned creation actions, never durable AO agents. */
  readonly linkedExecutions: readonly LinkedExecution[];
  readonly explanation: string;
}

export const hasAgentCapability = (access: AgentAccess, capability: AgentCapability): boolean =>
  access.supported && access.capabilities.includes(capability);

export interface HostActionResult {
  readonly ok: boolean;
  readonly message: string;
}

export interface HostExecutionLaunchRequest {
  readonly workingDirectory: string;
  readonly agentName?: string;
  readonly processPlan: AgentProcessPlan;
  readonly requestId: string;
}

export interface HostLaunchResult {
  readonly ok: boolean;
  readonly message: string;
  /** Opaque host execution target, used only to bind a later snapshot observation. */
  readonly executionRef?: string;
}

export interface SessionHost {
  snapshot(): Effect.Effect<HostSnapshot, HostError>;
  launchExecution(request: HostExecutionLaunchRequest): Effect.Effect<HostLaunchResult, HostError>;
  access(agent: {
    readonly hostKind: string;
    readonly nativeId: string;
  }): Effect.Effect<AgentAccess, HostError>;
  activate(access: AgentAccess): Effect.Effect<HostActionResult, HostError>;
  closeAgent(access: AgentAccess): Effect.Effect<HostActionResult, HostError>;
  openTerminal(
    access: AgentAccess,
    dimensions: TerminalDimensions,
    options?: TerminalOpenOptions,
  ): Effect.Effect<HostTerminalOpenResult, HostError>;
  openLinkedExecutionTerminal(
    execution: LinkedExecution,
    dimensions: TerminalDimensions,
    options?: TerminalOpenOptions,
  ): Effect.Effect<HostTerminalOpenResult, HostError>;
}
