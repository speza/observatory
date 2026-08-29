import type { Effect } from "effect";

export const OBSERVATORY_PLUGIN_API_VERSION = 2 as const;

export type PluginCapability = "agent-harness" | "code-host";

export interface AgentHarnessDescriptor {
  readonly harnessId: string;
  readonly label: string;
  readonly description?: string;
}

export interface HarnessAvailability {
  readonly available: boolean;
  readonly version?: string;
  readonly message: string;
}

/** Sensitive provider identity. Core may persist and compare it, but never parses `value`. */
export interface OpaqueNativeConversationRef {
  readonly harnessId: string;
  /** Opaque provider installation/account/storage scope. */
  readonly continuityScopeId?: string;
  readonly kind: string;
  readonly value: string;
}

export type ProviderSessionProvenance = "provider-index" | "session-header";

export interface ProviderSessionObservation {
  readonly nativeConversationRef: OpaqueNativeConversationRef;
  /** Alternate provider-owned opaque references, such as a transcript path. */
  readonly nativeConversationAliases?: readonly OpaqueNativeConversationRef[];
  readonly providerInstanceId: string;
  readonly homeSiteRef?: string;
  readonly createdAt?: number;
  readonly lastActiveAt?: number;
  readonly title?: string;
  readonly workspaceRef?: string;
  readonly resumeEligibility: "same-site" | "provider-account" | "blocked" | "unknown";
  readonly provenance: ProviderSessionProvenance;
}

export interface ProviderSessionSnapshot {
  readonly harnessId: string;
  readonly providerInstanceId: string;
  readonly continuityScopeId: string;
  readonly observedAt: number;
  readonly complete: boolean;
  readonly sessions: readonly ProviderSessionObservation[];
  readonly diagnostics: readonly string[];
}

export interface AgentProcessPlan {
  readonly harnessId: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  /** Argument positions whose values must be redacted from diagnostics. */
  readonly sensitiveArgumentIndexes?: readonly number[];
  /**
   * Known before launch only when the provider itself supplied a reference for
   * this operation. New-session plans normally omit it and let provider-owned
   * observations report the generated identity asynchronously.
   */
  readonly nativeConversationRef?: OpaqueNativeConversationRef;
}

export interface StartHarnessSessionRequest {
  readonly workingDirectory: string;
  readonly prompt?: string;
  readonly args?: readonly string[];
}

export interface ResumeHarnessSessionRequest extends StartHarnessSessionRequest {
  readonly nativeConversationRef: OpaqueNativeConversationRef;
}

export interface HarnessObservationEvidence {
  readonly executionRef: string;
  readonly detectedHarnessId?: string;
  readonly nativeConversationRef?: OpaqueNativeConversationRef;
  readonly restoreState?: "host-restored" | "not-restored" | "unknown";
  readonly source: "native-integration" | "hook" | "process" | "unknown";
  readonly observedAt: number;
}

export interface ContinuityRequest {
  readonly expectedNativeConversationRef?: OpaqueNativeConversationRef;
  readonly observation?: HarnessObservationEvidence;
  /** Opaque host target returned by the launch performed in this coordinator operation. */
  readonly launchExecutionRef?: string;
}

export type ContinuityResult =
  | {
      readonly kind: "same";
      readonly nativeConversationRef?: OpaqueNativeConversationRef;
      readonly reason: string;
    }
  | { readonly kind: "replaced" | "absent" | "unknown"; readonly reason: string };

export class HarnessError extends Error {
  readonly _tag = "HarnessError" as const;

  constructor(
    readonly operation: "availability" | "catalogue" | "plan-start" | "plan-resume" | "continuity",
    message: string,
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

export interface AgentHarness {
  readonly harnessId: string;
  describe(): AgentHarnessDescriptor;
  availability(): Effect.Effect<HarnessAvailability, HarnessError>;
  snapshotSessions(): Effect.Effect<ProviderSessionSnapshot, HarnessError>;
  planStart(request: StartHarnessSessionRequest): Effect.Effect<AgentProcessPlan, HarnessError>;
  planResume(request: ResumeHarnessSessionRequest): Effect.Effect<AgentProcessPlan, HarnessError>;
  proveContinuity(request: ContinuityRequest): Effect.Effect<ContinuityResult, HarnessError>;
}

export interface RepositoryIdentity {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
}

export interface GitRevisionIdentity {
  readonly repository: RepositoryIdentity;
  readonly branch: string;
  readonly head: string;
}

export type CheckConclusion = "passing" | "pending" | "failing" | "unknown";

export interface PullRequestStatus {
  readonly providerId: string;
  readonly repository: RepositoryIdentity;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly draft: boolean;
  readonly baseBranch: string;
  readonly headBranch: string;
  readonly head: string;
  readonly author?: string;
  readonly checks: CheckConclusion;
  readonly review: "approved" | "changes-requested" | "review-required" | "unknown";
  readonly mergeability: "mergeable" | "conflicting" | "unknown";
  readonly updatedAt?: string;
}

export class CodeHostError extends Error {
  readonly _tag = "CodeHostError" as const;

  constructor(
    readonly kind: "unavailable" | "authentication-required" | "rate-limited" | "invalid-response",
    message: string,
  ) {
    super(message);
    this.name = "CodeHostError";
  }
}

export interface CodeHostingProvider {
  readonly providerId: string;
  supports(repository: RepositoryIdentity): boolean;
  pullRequests(
    revision: GitRevisionIdentity,
  ): Effect.Effect<readonly PullRequestStatus[], CodeHostError>;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface BoundedProcessRunner {
  run(
    argv: readonly string[],
    options?: { readonly cwd?: string; readonly maxOutputBytes?: number },
  ): Promise<ProcessResult>;
}

export interface PluginLogger {
  info(message: string): void;
  warn(message: string): void;
}

export type PluginConfigurationValue =
  | string
  | number
  | boolean
  | null
  | readonly PluginConfigurationValue[]
  | PluginConfiguration;

export interface PluginConfiguration {
  readonly [key: string]: PluginConfigurationValue;
}

export interface PluginContext {
  readonly config: PluginConfiguration;
  readonly process: BoundedProcessRunner;
  readonly logger: PluginLogger;
  readonly now: () => number;
}

export interface PluginContributions {
  readonly agentHarnesses?: readonly AgentHarness[];
  readonly codeHosts?: readonly CodeHostingProvider[];
  readonly dispose?: () => Promise<void> | void;
}

export interface ObservatoryPlugin {
  activate(context: PluginContext): Promise<PluginContributions> | PluginContributions;
}
