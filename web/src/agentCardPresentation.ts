import { formatAge } from "../../src/attention/attention.ts";
import type { AgentView, ProviderEvidenceView } from "../../src/projection/types.ts";

const TITLE_LINE_LENGTH = 26;
const DETAIL_LENGTH = 35;
const CONTEXT_LENGTH = 34;

const concise = (value: string | undefined, maximumCharacters: number): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= maximumCharacters) return normalized;
  return `${normalized.slice(0, maximumCharacters - 1).trimEnd()}…`;
};

const takeLine = (value: string, maximumCharacters: number) => {
  if (value.length <= maximumCharacters) return { line: value, remainder: "" };
  const window = value.slice(0, maximumCharacters + 1);
  const space = window.lastIndexOf(" ", maximumCharacters);
  const hyphen = window.lastIndexOf("-", maximumCharacters - 1);
  const naturalBreak = Math.max(space, hyphen);
  const breakAt =
    naturalBreak >= Math.floor(maximumCharacters / 2) ? naturalBreak : maximumCharacters;
  const includesHyphen = breakAt === hyphen;
  return {
    line: value.slice(0, breakAt + (includesHyphen ? 1 : 0)).trimEnd(),
    remainder: value.slice(breakAt + (includesHyphen ? 1 : 0)).trimStart(),
  };
};

export const agentTitleLines = (value: string): readonly string[] => {
  const normalized = value.trim().replace(/\s+/gu, " ") || "Unnamed agent";
  const first = takeLine(normalized, TITLE_LINE_LENGTH);
  if (!first.remainder) return [first.line];
  return [first.line, concise(first.remainder, TITLE_LINE_LENGTH) ?? ""];
};

const observedAge = (evidence: ProviderEvidenceView): string | undefined => {
  if (evidence.ageMs === undefined) return undefined;
  if (evidence.ageMs < 10_000) return "now";
  return formatAge(evidence.ageMs);
};

const withAge = (label: string, evidence: ProviderEvidenceView): string => {
  const age = observedAge(evidence);
  return age ? `${label} · ${age}` : label;
};

const requestLabel = (kind: NonNullable<ProviderEvidenceView["request"]>["kind"]): string => {
  if (kind === "permission") return "permission needed";
  if (kind === "question") return "question asked";
  if (kind === "plan-approval") return "plan approval needed";
  return "input needed";
};

const activityLabel = (evidence: ProviderEvidenceView): string | undefined => {
  if (evidence.request?.state === "open")
    return withAge(`Observed: ${requestLabel(evidence.request.kind)}`, evidence);
  if (evidence.health === "stale") return withAge("Provider observation stale", evidence);
  if (evidence.health === "unavailable") return "Provider observations unavailable";
  if (evidence.health === "degraded") return withAge("Provider observations degraded", evidence);
  if (evidence.hostConflict) return withAge("Provider and host disagree", evidence);
  if (evidence.activity === "compacting") return withAge("Observed: compacting context", evidence);
  if (evidence.activity === "responding") return withAge("Observed: composing response", evidence);
  if (evidence.activity === "idle") return withAge("Observed: provider idle", evidence);
  if (evidence.activity === "using-tool") {
    const toolActivity = {
      read: "reading files",
      write: "writing files",
      execute: "executing a command",
      search: "searching",
      network: "using the network",
      delegate: "delegating work",
      other: "using a tool",
    }[evidence.toolCategory ?? "other"];
    return withAge(`Observed: ${toolActivity}`, evidence);
  }
  if (evidence.outcome === "response-completed")
    return withAge("Observed: response complete", evidence);
  if (evidence.outcome === "failed") return withAge("Observed: response failed", evidence);
  if (evidence.outcome === "interrupted")
    return withAge("Observed: response interrupted", evidence);
  return undefined;
};

const attentionLabel = (agent: AgentView): string | undefined => {
  const attention = agent.attention;
  if (!attention) return undefined;
  const label = {
    blocked: "Blocked · may need input",
    waiting: "Waiting for human input",
    "archived-running": "Archived while still running",
    "runtime-complete": "Result ready for review",
    "ended-externally": "Execution ended · resolve Agent",
    "runtime-unknown": "Runtime state uncertain",
    "provider-input": undefined,
    "provider-failure": "Response failed · review needed",
    "provider-complete": "Response ready for review",
    "context-pressure": "Context pressure elevated",
    "provider-stale": "Input request may be stale",
    "provider-conflict": "Provider and host disagree",
  }[attention.reason];
  return label ? `${label} · ${formatAge(attention.ageMs)}` : undefined;
};

const basename = (value: string | undefined): string | undefined => value?.match(/[^\\/]+$/u)?.[0];

export interface AgentCardPresentation {
  readonly identity: string;
  readonly titleLines: readonly string[];
  readonly detail?: string;
  readonly context?: string;
}

export const presentAgentCard = (agent: AgentView): AgentCardPresentation => {
  const evidenceDetail = agent.providerEvidence ? activityLabel(agent.providerEvidence) : undefined;
  const detail =
    attentionLabel(agent) ?? evidenceDetail ?? concise(agent.description, DETAIL_LENGTH);
  const repository = basename(agent.repository) ?? basename(agent.worktree);
  const context = concise([repository, agent.branch].filter(Boolean).join(" · "), CONTEXT_LENGTH);
  return {
    identity:
      concise(agent.harnessId ?? agent.provider ?? "session", 16)?.toUpperCase() ?? "SESSION",
    titleLines: agentTitleLines(agent.displayName),
    detail: concise(detail, DETAIL_LENGTH),
    context,
  };
};
