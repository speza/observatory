import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  HarnessError,
  type AgentHarness,
  type AgentObservationSourceV1,
  type AgentHarnessDescriptor,
  type AgentProcessPlan,
  type BoundedProcessRunner,
  type ContinuityRequest,
  type ContinuityResult,
  type HarnessAvailability,
  type OpaqueNativeConversationRef,
  type ObservatoryPlugin,
  type ProviderSessionObservation,
  type ProviderSessionSnapshot,
  type ResumeHarnessSessionRequest,
  type StartHarnessSessionRequest,
} from "../../src/plugin-sdk/index.ts";
import {
  defaultProviderRoot,
  defaultObservationOutbox,
  observationMarker,
  observationProviderInstance,
  observationScope,
  type ProviderHarnessId,
} from "./provider-observation-installation.ts";
import { ProviderObservationJournal } from "./provider-observation-journal.ts";

interface HarnessDefinition {
  readonly descriptor: AgentHarnessDescriptor;
  readonly executable: string;
  readonly observationSource: AgentObservationSourceV1;
  snapshotSessions(): Promise<ProviderSessionSnapshot>;
  start(request: StartHarnessSessionRequest): AgentProcessPlan;
  resume(request: ResumeHarnessSessionRequest): AgentProcessPlan;
}

const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 500;

const ProviderConfigurationSchema = Schema.Struct({
  claudeProjectsRoot: Schema.optional(Schema.String),
  codexRoot: Schema.optional(Schema.String),
  piRoot: Schema.optional(Schema.String),
  claudeObservationOutbox: Schema.optional(Schema.String),
  codexObservationOutbox: Schema.optional(Schema.String),
  piObservationOutbox: Schema.optional(Schema.String),
  maxSessions: Schema.optional(Schema.Number),
});
type ProviderConfiguration = typeof ProviderConfigurationSchema.Type;

const ClaudeIndexSchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      sessionId: Schema.String,
      projectPath: Schema.optional(Schema.String),
      created: Schema.optional(Schema.String),
      modified: Schema.optional(Schema.String),
      fileMtime: Schema.optional(Schema.Number),
      fullPath: Schema.optional(Schema.String),
      isSidechain: Schema.optional(Schema.Boolean),
    }),
  ),
});
type ClaudeIndex = typeof ClaudeIndexSchema.Type;
const ClaudeSessionLineSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});

const CodexIndexRowSchema = Schema.Struct({
  id: Schema.String,
  thread_name: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
});
const CodexSubagentSourceSchema = Schema.Struct({ subagent: Schema.Unknown });
const CodexHeaderSchema = Schema.Struct({
  type: Schema.Literal("session_meta"),
  timestamp: Schema.optional(Schema.String),
  payload: Schema.Struct({
    id: Schema.String,
    timestamp: Schema.optional(Schema.String),
    cwd: Schema.optional(Schema.String),
    source: Schema.optional(Schema.Unknown),
    thread_source: Schema.optional(Schema.String),
  }),
});
type CodexHeader = typeof CodexHeaderSchema.Type;
const PiHeaderSchema = Schema.Struct({
  type: Schema.Literal("session"),
  id: Schema.String,
  timestamp: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});
type PiHeader = typeof PiHeaderSchema.Type;

const configuredLimit = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0
    ? Math.min(value, 5_000)
    : DEFAULT_MAX_SESSIONS;

const scopeFor = observationScope;
const providerInstanceFor = observationProviderInstance;

const configuredOutbox = (
  harnessId: ProviderHarnessId,
  configured: string | undefined,
): string | undefined => {
  const explicit = normalized(configured ?? "");
  if (explicit) return explicit;
  const path = defaultObservationOutbox(harnessId);
  return existsSync(observationMarker(path)) ? path : undefined;
};

const timestamp = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const claudeIndex = async (path: string): Promise<ClaudeIndex> => {
  const metadata = await stat(path);
  if (metadata.size > MAX_INDEX_BYTES)
    throw new Error("Provider index exceeds the safe read limit.");
  return Schema.decodeUnknownSync(Schema.parseJson(ClaudeIndexSchema))(
    await readFile(path, "utf8"),
  );
};

interface ClaudeSessionHeader {
  readonly sessionId: string;
  readonly workspaceRef?: string;
  readonly createdAt?: number;
  readonly lastActiveAt: number;
}

const claudeSessionHeader = async (path: string): Promise<ClaudeSessionHeader | undefined> => {
  const metadata = await stat(path);
  const text = await Bun.file(path)
    .slice(0, 256 * 1024)
    .text();
  let sessionId: string | undefined;
  let workspaceRef: string | undefined;
  let createdAt: number | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = Schema.decodeUnknownSync(Schema.parseJson(ClaudeSessionLineSchema))(line);
      sessionId ??= normalized(entry.sessionId ?? "");
      workspaceRef ??= normalized(entry.cwd ?? "");
      createdAt ??= timestamp(entry.timestamp);
      if (sessionId && workspaceRef) break;
    } catch {
      // A bounded read may end mid-record; earlier complete metadata remains usable.
    }
  }
  sessionId ??= normalized(basename(path, ".jsonl"));
  return sessionId
    ? { sessionId, workspaceRef, createdAt, lastActiveAt: metadata.mtimeMs }
    : undefined;
};

const walkFiles = async (
  root: string,
  matches: (name: string) => boolean,
): Promise<readonly string[]> => {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && matches(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
};

const sessionTitle = (label: string, workspace: string | undefined): string =>
  workspace ? `${label} · ${basename(workspace)}` : `${label} session`;

const claudeSnapshot = async (
  root: string,
  now: () => number,
  maxSessions: number,
): Promise<ProviderSessionSnapshot> => {
  const continuityScopeId = scopeFor("claude", root);
  const providerInstanceId = providerInstanceFor("claude", continuityScopeId);
  const indexes = await walkFiles(root, (name) => name === "sessions-index.json");
  const sessionFiles = (await walkFiles(root, (name) => name.endsWith(".jsonl"))).filter(
    (path) => !path.includes(`${join("", "subagents")}/`),
  );
  const recentSessionFiles = (
    await Promise.all(
      sessionFiles.map(async (path) => ({ path, modifiedAt: (await stat(path)).mtimeMs })),
    )
  )
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, maxSessions)
    .map(({ path }) => path);
  const diagnostics: string[] = [];
  const discovered = await Promise.all(
    indexes.map(async (path): Promise<readonly ProviderSessionObservation[]> => {
      try {
        const index = await claudeIndex(path);
        return index.entries.flatMap((entry) => {
          const sessionId = normalized(entry.sessionId);
          if (!sessionId || entry.isSidechain === true) return [];
          const workspaceRef = normalized(entry.projectPath ?? "");
          return [
            {
              nativeConversationRef: {
                harnessId: "claude",
                continuityScopeId,
                kind: "id",
                value: sessionId,
              },
              nativeConversationAliases: entry.fullPath
                ? [
                    {
                      harnessId: "claude",
                      continuityScopeId,
                      kind: "path",
                      value: entry.fullPath,
                    },
                  ]
                : [],
              providerInstanceId,
              homeSiteRef: "local",
              createdAt: timestamp(entry.created),
              lastActiveAt: timestamp(entry.modified) ?? entry.fileMtime,
              title: sessionTitle("Claude Code", workspaceRef),
              workspaceRef,
              resumeEligibility: workspaceRef ? "same-site" : "unknown",
              provenance: "provider-index",
            },
          ];
        });
      } catch {
        diagnostics.push("One Claude Code session index could not be read.");
        return [];
      }
    }),
  );
  const headerSessions = await Promise.all(
    recentSessionFiles.map(async (path): Promise<ProviderSessionObservation | undefined> => {
      try {
        const header = await claudeSessionHeader(path);
        if (!header) return undefined;
        return {
          nativeConversationRef: {
            harnessId: "claude",
            continuityScopeId,
            kind: "id",
            value: header.sessionId,
          },
          nativeConversationAliases: [
            { harnessId: "claude", continuityScopeId, kind: "path", value: path },
          ],
          providerInstanceId,
          homeSiteRef: "local",
          createdAt: header.createdAt,
          lastActiveAt: header.lastActiveAt,
          title: sessionTitle("Claude Code", header.workspaceRef),
          workspaceRef: header.workspaceRef,
          resumeEligibility: header.workspaceRef ? "same-site" : "unknown",
          provenance: "session-header",
        };
      } catch {
        diagnostics.push("One Claude Code session header could not be read.");
        return undefined;
      }
    }),
  );
  const sessionsById = new Map<string, ProviderSessionObservation>();
  for (const session of discovered.flat())
    sessionsById.set(session.nativeConversationRef.value, session);
  for (const session of headerSessions)
    if (session) sessionsById.set(session.nativeConversationRef.value, session);
  const sessions = [...sessionsById.values()];
  const ordered = sessions
    .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0))
    .slice(0, maxSessions);
  return {
    harnessId: "claude",
    providerInstanceId,
    continuityScopeId,
    observedAt: now(),
    complete:
      sessionFiles.length <= maxSessions &&
      sessions.length <= maxSessions &&
      diagnostics.length === 0,
    sessions: ordered,
    diagnostics,
  };
};

interface CodexIndexEntry {
  readonly id: string;
  readonly title?: string;
  readonly updatedAt?: number;
}

const codexIndex = async (path: string): Promise<ReadonlyMap<string, CodexIndexEntry>> => {
  const metadata = await stat(path);
  if (metadata.size > MAX_INDEX_BYTES)
    throw new Error("Provider index exceeds the safe read limit.");
  const entries = new Map<string, CodexIndexEntry>();
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const row = Schema.decodeUnknownSync(Schema.parseJson(CodexIndexRowSchema))(line);
    const id = normalized(row.id);
    if (!id) continue;
    entries.set(id, {
      id,
      title: normalized(row.thread_name ?? ""),
      updatedAt: timestamp(row.updated_at),
    });
  }
  return entries;
};

const firstJsonLine = async (path: string): Promise<CodexHeader | undefined> => {
  const file = Bun.file(path);
  const text = await file.slice(0, 64 * 1024).text();
  const line = text.split("\n", 1)[0];
  return line ? Schema.decodeUnknownSync(Schema.parseJson(CodexHeaderSchema))(line) : undefined;
};

const isImportableCodexSession = (payload: CodexHeader["payload"]): boolean => {
  if (payload.thread_source && payload.thread_source !== "user") return false;
  return !Schema.is(CodexSubagentSourceSchema)(payload.source);
};

const codexSnapshot = async (
  root: string,
  now: () => number,
  maxSessions: number,
): Promise<ProviderSessionSnapshot> => {
  const continuityScopeId = scopeFor("codex", root);
  const providerInstanceId = providerInstanceFor("codex", continuityScopeId);
  const indexPath = join(root, "session_index.jsonl");
  const index = await codexIndex(indexPath);
  const files = await walkFiles(join(root, "sessions"), (name) => name.endsWith(".jsonl"));
  const selectedFiles = files.slice(-maxSessions);
  const diagnostics: string[] = [];
  const discovered = await Promise.all(
    selectedFiles.map(async (path): Promise<ProviderSessionObservation | undefined> => {
      try {
        const header = await firstJsonLine(path);
        if (!header) return undefined;
        const payload = header.payload;
        if (!isImportableCodexSession(payload)) return undefined;
        const sessionId = normalized(payload.id);
        if (!sessionId) return undefined;
        const indexed = index.get(sessionId);
        const workspaceRef = normalized(payload.cwd ?? "");
        return {
          nativeConversationRef: {
            harnessId: "codex",
            continuityScopeId,
            kind: "id",
            value: sessionId,
          },
          nativeConversationAliases: [
            { harnessId: "codex", continuityScopeId, kind: "path", value: path },
          ],
          providerInstanceId,
          homeSiteRef: "local",
          createdAt: timestamp(payload.timestamp) ?? timestamp(header.timestamp),
          lastActiveAt: indexed?.updatedAt ?? (await stat(path)).mtimeMs,
          title: indexed?.title ?? sessionTitle("Codex", workspaceRef),
          workspaceRef,
          resumeEligibility: workspaceRef ? "same-site" : "unknown",
          provenance: "session-header",
        };
      } catch {
        diagnostics.push("One Codex session header could not be read.");
        return undefined;
      }
    }),
  );
  const sessions = discovered.filter(
    (session): session is ProviderSessionObservation => session !== undefined,
  );
  const ordered = sessions
    .sort((left, right) => (right.lastActiveAt ?? 0) - (left.lastActiveAt ?? 0))
    .slice(0, maxSessions);
  return {
    harnessId: "codex",
    providerInstanceId,
    continuityScopeId,
    observedAt: now(),
    complete: files.length <= maxSessions && diagnostics.length === 0,
    sessions: ordered,
    diagnostics,
  };
};

const piSnapshot = async (
  root: string,
  now: () => number,
  maxSessions: number,
): Promise<ProviderSessionSnapshot> => {
  const continuityScopeId = scopeFor("pi", root);
  const providerInstanceId = providerInstanceFor("pi", continuityScopeId);
  const files = await walkFiles(join(root, "sessions"), (name) => name.endsWith(".jsonl"));
  const selectedFiles = (
    await Promise.all(files.map(async (path) => ({ path, modifiedAt: (await stat(path)).mtimeMs })))
  )
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, maxSessions);
  const diagnostics: string[] = [];
  const discovered = await Promise.all(
    selectedFiles.map(
      async ({ path, modifiedAt }): Promise<ProviderSessionObservation | undefined> => {
        try {
          const file = Bun.file(path);
          const line = (await file.slice(0, 64 * 1024).text()).split("\n", 1)[0];
          if (!line) return undefined;
          const header: PiHeader = Schema.decodeUnknownSync(Schema.parseJson(PiHeaderSchema))(line);
          const sessionId = normalized(header.id);
          if (!sessionId) return undefined;
          const workspaceRef = normalized(header.cwd ?? "");
          return {
            nativeConversationRef: {
              harnessId: "pi",
              continuityScopeId,
              kind: "id",
              value: sessionId,
            },
            nativeConversationAliases: [
              { harnessId: "pi", continuityScopeId, kind: "path", value: path },
            ],
            providerInstanceId,
            homeSiteRef: "local",
            createdAt: timestamp(header.timestamp),
            lastActiveAt: modifiedAt,
            title: sessionTitle("Pi", workspaceRef),
            workspaceRef,
            resumeEligibility: workspaceRef ? "same-site" : "unknown",
            provenance: "session-header",
          };
        } catch {
          diagnostics.push("One Pi session header could not be read.");
          return undefined;
        }
      },
    ),
  );
  return {
    harnessId: "pi",
    providerInstanceId,
    continuityScopeId,
    observedAt: now(),
    complete: files.length <= maxSessions && diagnostics.length === 0,
    sessions: discovered.filter(
      (session): session is ProviderSessionObservation => session !== undefined,
    ),
    diagnostics,
  };
};

const normalized = (value: string): string | undefined => value.trim() || undefined;

const lifecycleArguments = new Set([
  "resume",
  "--resume",
  "--continue",
  "-r",
  "--session",
  "--session-id",
]);

const validateExtraArguments = (
  operation: "plan-start" | "plan-resume",
  args: readonly string[] | undefined,
): void => {
  if (args?.some((argument) => lifecycleArguments.has(argument.trim())))
    throw new HarnessError(
      operation,
      "Lifecycle arguments are controlled by the harness and cannot be overridden.",
    );
};

const appendPrompt = (args: readonly string[], prompt: string | undefined): readonly string[] => {
  const value = normalized(prompt ?? "");
  return value ? [...args, value] : args;
};

const refEquals = (
  left: OpaqueNativeConversationRef,
  right: OpaqueNativeConversationRef,
): boolean =>
  left.harnessId === right.harnessId &&
  left.continuityScopeId === right.continuityScopeId &&
  left.kind === right.kind &&
  left.value === right.value;

const continuityFor = (harnessId: string, request: ContinuityRequest): ContinuityResult => {
  const observation = request.observation;
  const expected = request.expectedNativeConversationRef;
  if (expected) {
    if (expected.harnessId !== harnessId)
      return { kind: "unknown", reason: "The expected conversation belongs to another harness." };
    if (!observation)
      return { kind: "absent", reason: "The expected native conversation was not observed." };
    if (observation.detectedHarnessId && observation.detectedHarnessId !== harnessId)
      return {
        kind: "replaced",
        reason: "The execution target now contains a different harness.",
      };
    if (!observation.nativeConversationRef)
      return {
        kind: "unknown",
        reason: "The host cannot prove the live native conversation identity.",
      };
    return refEquals(expected, observation.nativeConversationRef)
      ? {
          kind: "same",
          nativeConversationRef: expected,
          reason: "The host reported the exact expected native conversation.",
        }
      : {
          kind: "replaced",
          reason: "The execution target now contains another native conversation.",
        };
  }

  if (!observation)
    return { kind: "unknown", reason: "No post-launch host observation is available." };
  if (observation.detectedHarnessId !== harnessId)
    return {
      kind: "unknown",
      reason: "The host did not identify the launched harness.",
    };
  if (request.launchExecutionRef && observation.executionRef === request.launchExecutionRef)
    return {
      kind: "same",
      nativeConversationRef: observation.nativeConversationRef,
      reason: "The expected host target contains the launched harness.",
    };
  return {
    kind: "unknown",
    reason: "The observation cannot be tied to this launch operation.",
  };
};

class CliAgentHarness implements AgentHarness {
  readonly harnessId: string;
  readonly observationSource: AgentObservationSourceV1;

  constructor(
    private readonly definition: HarnessDefinition,
    private readonly process: BoundedProcessRunner,
  ) {
    this.harnessId = definition.descriptor.harnessId;
    this.observationSource = definition.observationSource;
  }

  describe(): AgentHarnessDescriptor {
    return this.definition.descriptor;
  }

  availability(): Effect.Effect<HarnessAvailability, HarnessError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.process.run([this.definition.executable, "--version"], {
          maxOutputBytes: 4_096,
        });
        if (result.exitCode !== 0)
          return {
            available: false,
            message: `${this.definition.descriptor.label} is unavailable.`,
          };
        const version = normalized(result.stdout);
        return {
          available: true,
          version,
          message: version
            ? `${this.definition.descriptor.label} ${version} is available.`
            : `${this.definition.descriptor.label} is available.`,
        };
      },
      catch: () =>
        new HarnessError(
          "availability",
          `${this.definition.descriptor.label} availability could not be checked.`,
        ),
    });
  }

  snapshotSessions(): Effect.Effect<ProviderSessionSnapshot, HarnessError> {
    return Effect.tryPromise({
      try: () => this.definition.snapshotSessions(),
      catch: () =>
        new HarnessError(
          "catalogue",
          `${this.definition.descriptor.label} sessions could not be discovered.`,
        ),
    });
  }

  planStart(request: StartHarnessSessionRequest): Effect.Effect<AgentProcessPlan, HarnessError> {
    return Effect.try({
      try: () => {
        validateExtraArguments("plan-start", request.args);
        return this.definition.start(request);
      },
      catch: (error) =>
        error instanceof HarnessError
          ? error
          : new HarnessError("plan-start", "The new-session plan could not be created."),
    });
  }

  planResume(request: ResumeHarnessSessionRequest): Effect.Effect<AgentProcessPlan, HarnessError> {
    if (
      request.nativeConversationRef.harnessId !== this.harnessId ||
      !normalized(request.nativeConversationRef.value)
    )
      return Effect.fail(
        new HarnessError("plan-resume", "The native conversation reference is invalid."),
      );
    return Effect.try({
      try: () => {
        validateExtraArguments("plan-resume", request.args);
        return this.definition.resume(request);
      },
      catch: (error) =>
        error instanceof HarnessError
          ? error
          : new HarnessError("plan-resume", "The resume plan could not be created."),
    });
  }

  proveContinuity(request: ContinuityRequest): Effect.Effect<ContinuityResult, HarnessError> {
    return Effect.succeed(continuityFor(this.harnessId, request));
  }
}

const claudeDefinition = (config: ProviderConfiguration, now: () => number): HarnessDefinition => ({
  descriptor: {
    harnessId: "claude",
    label: "Claude Code",
    description: "Anthropic Claude Code CLI",
  },
  executable: "claude",
  observationSource: new ProviderObservationJournal({
    harnessId: "claude",
    path: configuredOutbox("claude", config.claudeObservationOutbox),
    root: normalized(config.claudeProjectsRoot ?? "") ?? defaultProviderRoot("claude"),
    now,
  }),
  snapshotSessions: () =>
    claudeSnapshot(
      normalized(config.claudeProjectsRoot ?? "") ?? defaultProviderRoot("claude"),
      now,
      configuredLimit(config.maxSessions),
    ),
  start: (request) => {
    const sessionId = randomUUID();
    const nativeConversationRef = {
      harnessId: "claude",
      kind: "id",
      value: sessionId,
    } satisfies OpaqueNativeConversationRef;
    return {
      harnessId: "claude",
      executable: "claude",
      args: appendPrompt(["--session-id", sessionId, ...(request.args ?? [])], request.prompt),
      sensitiveArgumentIndexes: [1],
      nativeConversationRef,
    };
  },
  resume: (request) => ({
    harnessId: "claude",
    executable: "claude",
    args: appendPrompt(
      ["--resume", request.nativeConversationRef.value, ...(request.args ?? [])],
      request.prompt,
    ),
    sensitiveArgumentIndexes: [1],
    nativeConversationRef: request.nativeConversationRef,
  }),
});

const codexDefinition = (config: ProviderConfiguration, now: () => number): HarnessDefinition => ({
  descriptor: {
    harnessId: "codex",
    label: "Codex",
    description: "OpenAI Codex CLI",
  },
  executable: "codex",
  observationSource: new ProviderObservationJournal({
    harnessId: "codex",
    path: configuredOutbox("codex", config.codexObservationOutbox),
    root: normalized(config.codexRoot ?? "") ?? defaultProviderRoot("codex"),
    now,
  }),
  snapshotSessions: () =>
    codexSnapshot(
      normalized(config.codexRoot ?? "") ?? defaultProviderRoot("codex"),
      now,
      configuredLimit(config.maxSessions),
    ),
  start: (request) => ({
    harnessId: "codex",
    executable: "codex",
    args: appendPrompt(request.args ?? [], request.prompt),
  }),
  resume: (request) => ({
    harnessId: "codex",
    executable: "codex",
    args: appendPrompt(
      [...(request.args ?? []), "resume", request.nativeConversationRef.value],
      request.prompt,
    ),
    sensitiveArgumentIndexes: [(request.args?.length ?? 0) + 1],
    nativeConversationRef: request.nativeConversationRef,
  }),
});

const piDefinition = (config: ProviderConfiguration, now: () => number): HarnessDefinition => {
  const root = normalized(config.piRoot ?? "") ?? defaultProviderRoot("pi");
  return {
    descriptor: {
      harnessId: "pi",
      label: "Pi",
      description: "Pi coding agent CLI",
    },
    executable: "pi",
    observationSource: new ProviderObservationJournal({
      harnessId: "pi",
      path: configuredOutbox("pi", config.piObservationOutbox),
      root,
      now,
    }),
    snapshotSessions: () => piSnapshot(root, now, configuredLimit(config.maxSessions)),
    start: (request) => ({
      harnessId: "pi",
      executable: "pi",
      args: appendPrompt(request.args ?? [], request.prompt),
    }),
    resume: (request) => ({
      harnessId: "pi",
      executable: "pi",
      args: appendPrompt(
        ["--session", request.nativeConversationRef.value, ...(request.args ?? [])],
        request.prompt,
      ),
      sensitiveArgumentIndexes: [1],
      nativeConversationRef: request.nativeConversationRef,
    }),
  };
};

export const plugin: ObservatoryPlugin = {
  activate: (context) => {
    const config = Schema.decodeUnknownSync(ProviderConfigurationSchema)(context.config);
    return {
      agentHarnesses: [
        new CliAgentHarness(claudeDefinition(config, context.now), context.process),
        new CliAgentHarness(codexDefinition(config, context.now), context.process),
        new CliAgentHarness(piDefinition(config, context.now), context.process),
      ],
    };
  },
};
