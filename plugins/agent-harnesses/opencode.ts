import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  HarnessError,
  type AgentHarness,
  type AgentHarnessDescriptor,
  type AgentProcessPlan,
  type AgentHarnessSnapshotRequest,
  type BoundedProcessRunner,
  type ContinuityRequest,
  type ContinuityResult,
  type HarnessAvailability,
  type OpaqueNativeConversationRef,
  type ProviderSessionObservation,
  type ProviderSessionSnapshot,
  type ResumeHarnessSessionRequest,
  type StartHarnessSessionRequest,
} from "../../src/plugin-sdk/index.ts";
import { providerInstance } from "./provider-identity.ts";

export interface OpenCodeHarnessOptions {
  readonly runner: BoundedProcessRunner;
  readonly now: () => number;
  readonly maxSessions: number;
}

const MAX_FIELD_LENGTH = 1_000;
const MAX_ID_LENGTH = 512;
const MAX_CATALOGUE_OUTPUT_BYTES = 2 * 1024 * 1024;

const commonLifecycleOptions = [
  "--session",
  "-s",
  "--continue",
  "-c",
  "--fork",
  "--prompt",
  "serve",
  "run",
  "api",
  "--server",
  "--standalone",
  "--attach",
  "--dir",
  "--directory",
  "--cwd",
] as const;

const lifecycleOptions = new Set(commonLifecycleOptions);

const normalized = (value: string | undefined): string | undefined => value?.trim() || undefined;

type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonRecord;

interface JsonRecord {
  readonly [key: string]: JsonValue;
}

const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  ),
);
const JsonArraySchema = Schema.Array(JsonValueSchema);
const JsonRecordSchema = Schema.Record({ key: Schema.String, value: JsonValueSchema });

const isRecord = (value: JsonValue | undefined): value is JsonRecord =>
  value !== undefined && Schema.is(JsonRecordSchema)(value);

const stringField = (record: JsonRecord, key: string): string | undefined => {
  const value = record[key];
  return Schema.is(Schema.String)(value) ? value : undefined;
};

const numberField = (record: JsonRecord, key: string): number | undefined => {
  const value = record[key];
  return Schema.is(Schema.Number)(value) ? value : undefined;
};

const boundedId = (value: string | undefined): string | undefined => {
  const result = normalized(value);
  return result && result.length <= MAX_ID_LENGTH ? result : undefined;
};

const boundedTitle = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const result = value.replace(/\s+/gu, " ").trim();
  return result ? result.slice(0, MAX_FIELD_LENGTH) : undefined;
};

const boundedPath = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const result = value.trim();
  return result.length <= MAX_FIELD_LENGTH && isAbsolute(result) ? result : undefined;
};

const epochMilliseconds = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return value <= 8.64e15 ? value : undefined;
};

const parseJson = (text: string): JsonValue | undefined => {
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(JsonValueSchema))(text);
  } catch {
    return undefined;
  }
};

const stableScope = (scopeKey: string): string =>
  createHash("sha256").update(`opencode\u0000${scopeKey}`).digest("hex").slice(0, 24);

interface OpenCodeScope {
  readonly continuityScopeId: string;
  readonly providerInstanceId: string;
}

const scopeFor = (scopeKey: string): OpenCodeScope => {
  const continuityScopeId = stableScope(scopeKey);
  return {
    continuityScopeId,
    providerInstanceId: providerInstance("opencode", continuityScopeId),
  };
};

const noRawProcessError = (label: string): Error =>
  new Error(`${label} did not return usable metadata.`);

const processSucceeded = (result: Awaited<ReturnType<BoundedProcessRunner["run"]>>): boolean =>
  result.exitCode === 0 && !result.timedOut && !result.stdoutTruncated;

const sessionObservation = (
  scope: OpenCodeScope,
  row: JsonRecord,
  id: string,
  time: JsonRecord | undefined,
  directory: string | undefined,
): ProviderSessionObservation => {
  const workspaceRef = boundedPath(directory);
  return {
    nativeConversationRef: {
      harnessId: "opencode",
      continuityScopeId: scope.continuityScopeId,
      kind: "id",
      value: id,
    },
    providerInstanceId: scope.providerInstanceId,
    homeSiteRef: "local",
    createdAt: epochMilliseconds(time ? numberField(time, "created") : numberField(row, "created")),
    lastActiveAt: epochMilliseconds(
      time ? numberField(time, "updated") : numberField(row, "updated"),
    ),
    title: boundedTitle(stringField(row, "title")),
    workspaceRef,
    resumeEligibility: workspaceRef ? "same-site" : "unknown",
    provenance: "provider-index",
  };
};

interface ParsedRows {
  readonly sessions: readonly ProviderSessionObservation[];
  readonly invalidRows: number;
  readonly childRows: number;
}

const parseV1Rows = (
  rows: readonly JsonValue[],
  scope: OpenCodeScope,
  maxSessions: number,
): ParsedRows => {
  const sessions: ProviderSessionObservation[] = [];
  let invalidRows = 0;
  let childRows = 0;
  const seen = new Set<string>();
  for (const value of rows) {
    if (!isRecord(value)) {
      invalidRows += 1;
      continue;
    }
    if (
      (value.parentID !== undefined && value.parentID !== null) ||
      (value.parentId !== undefined && value.parentId !== null)
    ) {
      childRows += 1;
      continue;
    }
    const id = boundedId(stringField(value, "id"));
    if (!id || seen.has(id)) {
      invalidRows += 1;
      continue;
    }
    seen.add(id);
    sessions.push(sessionObservation(scope, value, id, undefined, stringField(value, "directory")));
  }
  return {
    sessions: sessions.slice(0, maxSessions),
    invalidRows,
    childRows,
  };
};

const v1Diagnostics = (invalidRows: number, childRows: number, capped: boolean): string[] => [
  ...(invalidRows > 0 ? [`${invalidRows} OpenCode session rows were ignored.`] : []),
  ...(childRows > 0 ? [`${childRows} OpenCode child sessions were ignored.`] : []),
  ...(capped ? ["The OpenCode session catalogue reached its configured limit."] : []),
];

const catalogueDirectories = (
  request: AgentHarnessSnapshotRequest | undefined,
): readonly string[] => {
  const candidates = [process.cwd(), ...(request?.workspaceRefs ?? [])];
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const candidate of candidates) {
    const bounded = boundedPath(candidate);
    if (!bounded) continue;
    const directory = resolve(bounded);
    if (seen.has(directory)) continue;
    seen.add(directory);
    directories.push(directory);
  }
  return directories;
};

const snapshotV1Catalogue = async (
  options: OpenCodeHarnessOptions,
  scope: OpenCodeScope,
  request: AgentHarnessSnapshotRequest | undefined,
): Promise<ProviderSessionSnapshot> => {
  const sessions: ProviderSessionObservation[] = [];
  const seenIds = new Set<string>();
  let invalidRows = 0;
  let childRows = 0;
  let capped = false;
  let failedDirectories = 0;
  const directories = catalogueDirectories(request);

  for (const directory of directories) {
    if (sessions.length >= options.maxSessions) {
      capped = true;
      break;
    }
    let result: Awaited<ReturnType<BoundedProcessRunner["run"]>>;
    try {
      // Workspace queries are independent, but remain sequential to keep the
      // provider's local database load bounded during a refresh.
      // eslint-disable-next-line no-await-in-loop
      result = await options.runner.run(
        [
          "opencode",
          "--pure",
          "session",
          "list",
          "--format",
          "json",
          "--max-count",
          String(options.maxSessions),
        ],
        { cwd: directory, maxOutputBytes: MAX_CATALOGUE_OUTPUT_BYTES },
      );
    } catch {
      failedDirectories += 1;
      continue;
    }
    if (!processSucceeded(result)) {
      failedDirectories += 1;
      continue;
    }

    const payload = result.stdout.trim() ? parseJson(result.stdout) : [];
    if (!Schema.is(JsonArraySchema)(payload)) {
      invalidRows += 1;
      continue;
    }
    const parsed = parseV1Rows(payload, scope, options.maxSessions);
    invalidRows += parsed.invalidRows;
    childRows += parsed.childRows;
    for (const session of parsed.sessions) {
      if (sessions.length >= options.maxSessions) {
        capped = true;
        break;
      }
      const id = session.nativeConversationRef.value;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      sessions.push(session);
    }
    if (payload.length >= options.maxSessions) capped = true;
  }

  const diagnostics = [
    ...v1Diagnostics(invalidRows, childRows, capped),
    ...(failedDirectories > 0
      ? [
          `OpenCode session catalogue failed for ${failedDirectories} workspace ${failedDirectories === 1 ? "query" : "queries"}.`,
        ]
      : []),
  ];
  return {
    harnessId: "opencode",
    providerInstanceId: scope.providerInstanceId,
    continuityScopeId: scope.continuityScopeId,
    observedAt: options.now(),
    complete: failedDirectories === 0 && !capped && invalidRows === 0 && childRows === 0,
    sessions,
    diagnostics,
  };
};

const lifecycleOptionName = (value: string): string | undefined => {
  if (value === "--") return value;
  if (value.startsWith("--")) return value.split("=", 1)[0];
  if (value.startsWith("-") && value.length > 1) return value.slice(0, 2);
  return undefined;
};

const validateLifecycleArguments = (
  operation: "plan-start" | "plan-resume",
  args: readonly string[] | undefined,
): readonly string[] => {
  const values = args ?? [];
  let expectsOptionValue = false;
  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value) throw new HarnessError(operation, "OpenCode arguments must not be empty.");
    const option = lifecycleOptionName(value);
    if (option !== undefined) {
      if (value === "--" || lifecycleOptions.has(option))
        throw new HarnessError(
          operation,
          "OpenCode lifecycle, server, or positional project arguments are not allowed.",
        );
      expectsOptionValue = !value.includes("=");
      continue;
    }
    if (lifecycleOptions.has(value) || !expectsOptionValue)
      throw new HarnessError(
        operation,
        "OpenCode lifecycle, server, or positional project arguments are not allowed.",
      );
    expectsOptionValue = false;
  }
  return values;
};

const validateResumePrompt = (prompt: string | undefined): void => {
  if (normalized(prompt ?? ""))
    throw new HarnessError(
      "plan-resume",
      "OpenCode resume prompts are unsupported until exact delivery is version-tested.",
    );
};

const compatibleReference = (reference: OpaqueNativeConversationRef): boolean =>
  reference.harnessId === "opencode" &&
  reference.kind === "id" &&
  boundedId(reference.value) !== undefined;

const referenceMatches = (
  expected: OpaqueNativeConversationRef,
  observed: OpaqueNativeConversationRef,
): boolean =>
  expected.harnessId === observed.harnessId &&
  expected.kind === observed.kind &&
  expected.value === observed.value &&
  (expected.continuityScopeId === undefined ||
    observed.continuityScopeId === undefined ||
    expected.continuityScopeId === observed.continuityScopeId);

const continuityFor = (request: ContinuityRequest): ContinuityResult => {
  const expected = request.expectedNativeConversationRef;
  const observation = request.observation;
  if (expected) {
    if (!compatibleReference(expected))
      return { kind: "unknown", reason: "The expected conversation belongs to another harness." };
    if (!observation)
      return { kind: "absent", reason: "The expected native conversation was not observed." };
    if (observation.detectedHarnessId && observation.detectedHarnessId !== "opencode")
      return { kind: "unknown", reason: "The host reported a different harness." };
    const observed = observation.nativeConversationRef;
    if (!observed)
      return {
        kind: "unknown",
        reason: "The host cannot prove the live native conversation identity.",
      };
    if (observed.harnessId !== "opencode" || observed.kind !== "id")
      return {
        kind: "unknown",
        reason: "The host reported an incompatible conversation identity.",
      };
    return referenceMatches(expected, observed)
      ? {
          kind: "same",
          nativeConversationRef: expected,
          reason: "The host reported the exact expected OpenCode conversation.",
        }
      : {
          kind: "replaced",
          reason: "The execution target now contains another OpenCode conversation.",
        };
  }

  if (!observation)
    return { kind: "unknown", reason: "No post-launch host observation is available." };
  if (observation.detectedHarnessId !== "opencode")
    return { kind: "unknown", reason: "The host did not identify the selected OpenCode harness." };
  const observed = observation.nativeConversationRef;
  if (!observed || !compatibleReference(observed))
    return { kind: "unknown", reason: "The launch has no exact OpenCode conversation evidence." };
  if (request.launchExecutionRef && observation.executionRef === request.launchExecutionRef)
    return {
      kind: "same",
      nativeConversationRef: observed,
      reason: "The launch target reported an exact OpenCode conversation.",
    };
  return { kind: "unknown", reason: "The observation cannot be tied to this launch operation." };
};

const unavailable = (label: string): HarnessAvailability => ({
  available: false,
  message: `${label} is unavailable.`,
});

class OpenCodeHarness implements AgentHarness {
  readonly harnessId = "opencode" as const;
  private readonly descriptor: AgentHarnessDescriptor = {
    harnessId: "opencode",
    label: "OpenCode",
    description: "OpenCode interactive coding-agent CLI",
  };

  constructor(private readonly options: OpenCodeHarnessOptions) {}

  describe(): AgentHarnessDescriptor {
    return this.descriptor;
  }

  availability(): Effect.Effect<HarnessAvailability, HarnessError> {
    return Effect.tryPromise({
      try: async () => {
        try {
          const versionResult = await this.options.runner.run(["opencode", "--version"], {
            maxOutputBytes: 4_096,
          });
          if (!processSucceeded(versionResult)) return unavailable(this.descriptor.label);
          const version = boundedTitle(versionResult.stdout);
          return {
            available: true,
            version,
            message: version
              ? `${this.descriptor.label} ${version} is available.`
              : `${this.descriptor.label} is available.`,
          };
        } catch {
          return unavailable(this.descriptor.label);
        }
      },
      catch: () =>
        new HarnessError(
          "availability",
          `${this.descriptor.label} availability could not be checked.`,
        ),
    });
  }

  snapshotSessions(
    request?: AgentHarnessSnapshotRequest,
  ): Effect.Effect<ProviderSessionSnapshot, HarnessError> {
    return Effect.tryPromise({
      try: async () => {
        const scope = await this.scope();
        return snapshotV1Catalogue(this.options, scope, request);
      },
      catch: () =>
        new HarnessError("catalogue", `${this.descriptor.label} sessions could not be discovered.`),
    });
  }

  planStart(request: StartHarnessSessionRequest): Effect.Effect<AgentProcessPlan, HarnessError> {
    return Effect.try({
      try: () => {
        const args = validateLifecycleArguments("plan-start", request.args);
        const prompt = normalized(request.prompt ?? "");
        if (!prompt)
          return {
            harnessId: this.harnessId,
            executable: this.harnessId,
            args,
          };
        return {
          harnessId: this.harnessId,
          executable: this.harnessId,
          args: ["--prompt", prompt, ...args],
          sensitiveArgumentIndexes: [1],
        };
      },
      catch: (error) =>
        error instanceof HarnessError
          ? error
          : new HarnessError("plan-start", "The new OpenCode session plan could not be created."),
    });
  }

  planResume(request: ResumeHarnessSessionRequest): Effect.Effect<AgentProcessPlan, HarnessError> {
    if (!compatibleReference(request.nativeConversationRef))
      return Effect.fail(
        new HarnessError("plan-resume", "The native OpenCode conversation reference is invalid."),
      );
    return Effect.tryPromise({
      try: async () => {
        validateResumePrompt(request.prompt);
        const args = validateLifecycleArguments("plan-resume", request.args);
        const referenceScope = request.nativeConversationRef.continuityScopeId;
        if (referenceScope !== undefined) {
          const scope = await this.scope();
          if (referenceScope !== scope.continuityScopeId)
            throw new HarnessError(
              "plan-resume",
              "The OpenCode conversation scope does not match.",
            );
        }
        return {
          harnessId: this.harnessId,
          executable: this.harnessId,
          args: ["--session", request.nativeConversationRef.value, ...args],
          sensitiveArgumentIndexes: [1],
          nativeConversationRef: request.nativeConversationRef,
        };
      },
      catch: (error) =>
        error instanceof HarnessError
          ? error
          : new HarnessError("plan-resume", "The OpenCode resume plan could not be created."),
    });
  }

  proveContinuity(request: ContinuityRequest): Effect.Effect<ContinuityResult, HarnessError> {
    return Effect.succeed(continuityFor(request));
  }

  private async scope(): Promise<OpenCodeScope> {
    const result = await this.options.runner.run(["opencode", "--pure", "db", "path"], {
      maxOutputBytes: 4_096,
    });
    if (!processSucceeded(result)) throw noRawProcessError("OpenCode database scope");
    const databasePath = result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .toReversed()
      .find(Boolean);
    if (!databasePath || !isAbsolute(databasePath) || databasePath.length > MAX_FIELD_LENGTH)
      throw noRawProcessError("OpenCode database scope");
    return scopeFor(resolve(databasePath));
  }
}

export const createOpenCodeHarness = (options: OpenCodeHarnessOptions): AgentHarness =>
  new OpenCodeHarness(options);
