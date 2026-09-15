import { Schema } from "effect";
import { WebPrioritySchema } from "./vocabulary.ts";
import { WebPortfolioResponseSchema } from "./views.ts";

/**
 * Auxiliary feature responses owned by the web contract: launch choices,
 * closeout, workspace review, repository status, plugin diagnostics and
 * conversation history. Gateways map domain results onto these shapes; each
 * mirror is bound to its domain counterpart by the gateway's typed functions.
 */

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));

export const WebLaunchSystemSchema = Schema.Struct({ id: Schema.String, title: Schema.String });
export type WebLaunchSystem = Schema.Schema.Type<typeof WebLaunchSystemSchema>;

export const WebLaunchGoalSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  priority: WebPrioritySchema,
});
export type WebLaunchGoal = Schema.Schema.Type<typeof WebLaunchGoalSchema>;

const WorkspaceChoice = Schema.Struct({
  path: Schema.String,
  label: Schema.String,
  kind: Schema.Literal("workspace", "directory"),
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  available: Schema.Boolean,
});

export const LaunchOptionsResponseSchema = Schema.Struct({
  kind: Schema.Literal("launch-options"),
  systems: Schema.Array(WebLaunchSystemSchema),
  goals: Schema.Array(WebLaunchGoalSchema),
  locations: Schema.Array(WorkspaceChoice),
  agents: Schema.Array(
    Schema.Struct({
      harnessId: Schema.String,
      label: Schema.String,
      description: Schema.optional(Schema.String),
    }),
  ),
});
export type WebLaunchOptionsResponse = Schema.Schema.Type<typeof LaunchOptionsResponseSchema>;

export const WorkspaceBrowserResponseSchema = Schema.Struct({
  kind: Schema.Literal("workspace-browser"),
  path: Schema.String,
  parentPath: Schema.optional(Schema.String),
  entries: Schema.Array(WorkspaceChoice),
});
export type WebWorkspaceBrowserResponse = Schema.Schema.Type<typeof WorkspaceBrowserResponseSchema>;

export const WebCloseoutRequestSchema = Schema.Struct({
  agentIds: Schema.Array(Id).pipe(Schema.minItems(1), Schema.maxItems(100)),
});
export type WebCloseoutRequest = Schema.Schema.Type<typeof WebCloseoutRequestSchema>;

export const CloseoutResponseSchema = Schema.Struct({
  result: Schema.Struct({
    ok: Schema.Boolean,
    results: Schema.Array(
      Schema.Struct({
        ok: Schema.Boolean,
        agentId: Schema.String,
        status: Schema.Literal(
          "closed-and-archived",
          "already-ended-and-archived",
          "already-archived",
          "unsupported",
          "rejected",
        ),
        message: Schema.String,
      }),
    ),
    message: Schema.String,
  }),
  portfolio: WebPortfolioResponseSchema,
});
export type WebCloseoutResponse = Schema.Schema.Type<typeof CloseoutResponseSchema>;

const DiffFileContent = Schema.Struct({
  fileName: Schema.String,
  fileLang: Schema.optional(Schema.String),
  content: Schema.String,
});
const DiffFile = Schema.Struct({
  path: Schema.String,
  oldPath: Schema.optional(Schema.String),
  status: Schema.Literal("added", "modified", "deleted", "renamed", "copied", "untracked"),
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
  oldFile: Schema.optional(DiffFileContent),
  newFile: Schema.optional(DiffFileContent),
  hunks: Schema.Array(Schema.String),
});
const WorkingTreeDiffFields = {
  kind: Schema.Literal("working-tree-diff"),
  status: Schema.Literal("clean", "changed", "not-git", "unavailable"),
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  files: Schema.Array(DiffFile),
  additions: Schema.Number,
  deletions: Schema.Number,
  truncated: Schema.Boolean,
  generatedAt: Schema.Number,
  message: Schema.optional(Schema.String),
} as const;

const ReviewTreeEntry = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  name: Schema.String,
  kind: Schema.Literal("directory", "file"),
  change: Schema.optional(
    Schema.Literal("added", "modified", "deleted", "renamed", "copied", "untracked"),
  ),
  changedDescendants: Schema.Number,
  contentKind: Schema.optional(Schema.Literal("text", "binary", "oversized", "unknown")),
});
export const WorkspaceReviewResponseSchema = Schema.Struct({
  kind: Schema.Literal("workspace-review"),
  snapshotId: Schema.String,
  generatedAt: Schema.Number,
  status: Schema.Literal("complete", "partial", "unavailable", "not-git"),
  repository: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  tree: Schema.Array(ReviewTreeEntry),
  treeComplete: Schema.Boolean,
  changes: Schema.Struct(WorkingTreeDiffFields),
  diagnostics: Schema.Array(Schema.String),
  agentId: Schema.String,
  agentName: Schema.String,
  goalTitle: Schema.optional(Schema.String),
});
export type WebWorkspaceReviewResponse = Schema.Schema.Type<typeof WorkspaceReviewResponseSchema>;

export const WorkspaceReviewFileResponseSchema = Schema.Struct({
  kind: Schema.Literal("workspace-review-file"),
  snapshotId: Schema.String,
  fileId: Schema.String,
  displayPath: Schema.String,
  view: Schema.Literal("source", "baseline"),
  status: Schema.Literal("available", "stale", "missing", "binary", "oversized", "unavailable"),
  language: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  truncated: Schema.Boolean,
  generatedAt: Schema.Number,
  message: Schema.optional(Schema.String),
});
export type WebWorkspaceReviewFileResponse = Schema.Schema.Type<
  typeof WorkspaceReviewFileResponseSchema
>;

const RepositoryIdentity = Schema.Struct({
  host: Schema.String,
  owner: Schema.String,
  name: Schema.String,
});
const RepositoryPluginStatus = Schema.Struct({
  id: Schema.String,
  state: Schema.Literal("ready", "degraded", "disabled"),
  diagnostics: Schema.Array(Schema.String),
});
const RepositoryPullRequest = Schema.Struct({
  providerId: Schema.String,
  repository: RepositoryIdentity,
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  state: Schema.Literal("open", "closed", "merged"),
  draft: Schema.Boolean,
  baseBranch: Schema.String,
  headBranch: Schema.String,
  head: Schema.String,
  author: Schema.optional(Schema.String),
  checks: Schema.Literal("passing", "pending", "failing", "unknown"),
  review: Schema.Literal("approved", "changes-requested", "review-required", "unknown"),
  mergeability: Schema.Literal("mergeable", "conflicting", "unknown"),
  updatedAt: Schema.optional(Schema.String),
  association: Schema.Literal("confirmed", "candidate", "ambiguous"),
  headSync: Schema.Literal("current", "local-ahead", "different", "unknown"),
});
export const AgentRepositoryStatusResponseSchema = Schema.Struct({
  kind: Schema.Literal("agent-repository-status"),
  agentId: Schema.String,
  status: Schema.Literal("complete", "partial", "unavailable", "not-applicable"),
  observedAt: Schema.Number,
  diagnostics: Schema.Array(Schema.String),
  git: Schema.optional(
    Schema.Struct({
      worktree: Schema.String,
      repository: RepositoryIdentity,
      branch: Schema.optional(Schema.String),
      head: Schema.String,
      detached: Schema.Boolean,
      upstream: Schema.optional(Schema.String),
      ahead: Schema.optional(Schema.Number),
      behind: Schema.optional(Schema.Number),
      diff: Schema.Struct({
        ...WorkingTreeDiffFields,
        worktree: Schema.String,
      }),
    }),
  ),
  pullRequests: Schema.Array(RepositoryPullRequest),
  provider: Schema.optional(Schema.String),
  providerCached: Schema.Boolean,
  plugins: Schema.Array(RepositoryPluginStatus),
});
export type WebAgentRepositoryStatusResponse = Schema.Schema.Type<
  typeof AgentRepositoryStatusResponseSchema
>;

export const PluginStatusResponseSchema = Schema.Struct({
  kind: Schema.Literal("plugin-status"),
  plugins: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      displayName: Schema.String,
      version: Schema.String,
      apiVersion: Schema.Number,
      capabilities: Schema.Array(Schema.Literal("agent-harness", "code-host")),
      state: Schema.Literal("ready", "degraded", "disabled"),
      diagnostics: Schema.Array(Schema.String),
    }),
  ),
});
export type WebPluginStatusResponse = Schema.Schema.Type<typeof PluginStatusResponseSchema>;

const ConversationHistoryItem = Schema.Struct({
  handle: Schema.String,
  harnessId: Schema.String,
  providerLabel: Schema.String,
  title: Schema.String,
  workspaceRef: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.Number),
  lastActiveAt: Schema.optional(Schema.Number),
  resumeEligibility: Schema.Literal("same-site", "provider-account", "blocked", "unknown"),
  provenance: Schema.Literal("provider-index", "session-header"),
  runtimeState: Schema.Literal("dormant", "runtime-unknown"),
});
export const ConversationHistoryResponseSchema = Schema.Struct({
  kind: Schema.Literal("conversation-history"),
  conversations: Schema.Array(ConversationHistoryItem),
});
export type WebConversationHistoryResponse = Schema.Schema.Type<
  typeof ConversationHistoryResponseSchema
>;

export const AddConversationRequestSchema = Schema.Struct({
  handle: Schema.String,
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
});
export type WebAddConversationRequest = Schema.Schema.Type<typeof AddConversationRequestSchema>;

export const AddConversationResponseSchema = Schema.Struct({
  agentId: Schema.String,
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  portfolio: WebPortfolioResponseSchema,
});
export type WebAddConversationResponse = Schema.Schema.Type<typeof AddConversationResponseSchema>;

const DiscoveryHandle = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240));
export const AdmitDiscoveredExecutionRequestSchema = Schema.Struct({
  handle: DiscoveryHandle,
  goalId: Schema.optional(DiscoveryHandle),
  systemId: Schema.optional(DiscoveryHandle),
});
export type WebAdmitDiscoveredExecutionRequest = Schema.Schema.Type<
  typeof AdmitDiscoveredExecutionRequestSchema
>;

export const AdmitDiscoveredExecutionResponseSchema = Schema.Struct({
  agentId: Schema.String,
  goalId: Schema.optional(Schema.String),
  systemId: Schema.optional(Schema.String),
  message: Schema.String,
  partial: Schema.optional(Schema.Boolean),
  portfolio: WebPortfolioResponseSchema,
});
export type WebAdmitDiscoveredExecutionResponse = Schema.Schema.Type<
  typeof AdmitDiscoveredExecutionResponseSchema
>;

/** Derived item types the renderer needs without importing domain internals. */
export type WebReviewTreeEntry = Schema.Schema.Type<typeof ReviewTreeEntry>;
export type WebReviewContentKind = NonNullable<WebReviewTreeEntry["contentKind"]>;
export type WebReviewDiffFile = Schema.Schema.Type<typeof DiffFile>;
export type WebReviewDiffFileStatus = WebReviewDiffFile["status"];
export type WebReviewPullRequest = Schema.Schema.Type<typeof RepositoryPullRequest>;
export type WebConversationHistoryItem = Schema.Schema.Type<typeof ConversationHistoryItem>;
