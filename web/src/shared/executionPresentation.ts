import type { ExecutionPresentationView } from "../../../src/projection/types.ts";

export interface ExecutionPresentationSubject {
  readonly displayName: string;
  readonly displayNameSource?: "human" | "provider" | "fallback";
  readonly workspaceLabel?: string;
  readonly executionPresentation?: ExecutionPresentationView;
}

export interface ExecutionSurfacePresentation {
  readonly primaryLabel: string;
  readonly secondaryContext?: string;
}

const MAX_SECONDARY_CONTEXT_LENGTH = 240;

/** Normalize labels at the renderer boundary before comparing or combining them. */
export const normalizeExecutionPresentationLabel = (
  value: string | undefined,
): string | undefined => {
  const normalized = value?.trim().replace(/\s+/gu, " ");
  return normalized || undefined;
};

const bounded = (value: string): string => {
  if (value.length <= MAX_SECONDARY_CONTEXT_LENGTH) return value;
  return `${value.slice(0, MAX_SECONDARY_CONTEXT_LENGTH - 1).trimEnd()}…`;
};

const breadcrumbSegments = (value: string | undefined): readonly string[] =>
  normalizeExecutionPresentationLabel(value)
    ?.split(/\s*·\s*/u)
    .map((segment) => normalizeExecutionPresentationLabel(segment))
    .filter((segment): segment is string => segment !== undefined) ?? [];

const semanticKey = (value: string): string => value.toLowerCase();

const appendUniqueSegments = (
  output: string[],
  seen: Set<string>,
  excluded: ReadonlySet<string>,
  value: string | undefined,
): void => {
  for (const segment of breadcrumbSegments(value)) {
    const key = semanticKey(segment);
    if (excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    output.push(segment);
  }
};

/**
 * Choose one renderer title without letting live evidence override a human name.
 * A named tab lives in context, so context is the fallback when no individual
 * host label is available.
 */
export const executionPrimaryLabel = (subject: ExecutionPresentationSubject): string => {
  if (subject.displayNameSource === "human")
    return bounded(normalizeExecutionPresentationLabel(subject.displayName) ?? "Unnamed agent");
  const label = normalizeExecutionPresentationLabel(subject.executionPresentation?.label);
  if (label) return bounded(label);
  const context = normalizeExecutionPresentationLabel(subject.executionPresentation?.context);
  if (context) return bounded(context);
  return bounded(normalizeExecutionPresentationLabel(subject.displayName) ?? "Unnamed execution");
};

/**
 * Return secondary execution context as a deduplicated breadcrumb. Contexts can
 * already contain their group (for example `frontier · release`), so dedupe by
 * breadcrumb segment rather than only by whole-string equality.
 */
export const executionSecondaryContext = (
  subject: ExecutionPresentationSubject,
): string | undefined => {
  const presentation = subject.executionPresentation;
  if (!presentation && !subject.workspaceLabel) return undefined;
  const primarySource =
    subject.displayNameSource === "human"
      ? subject.displayName
      : (presentation?.label ?? presentation?.context ?? subject.displayName);
  const primarySegments = new Set(breadcrumbSegments(primarySource).map(semanticKey));
  const output: string[] = [];
  const seen = new Set<string>();
  const values =
    subject.displayNameSource === "human"
      ? [presentation?.label, presentation?.context, presentation?.group, subject.workspaceLabel]
      : [presentation?.context, presentation?.group, subject.workspaceLabel];
  for (const value of values) appendUniqueSegments(output, seen, primarySegments, value);
  return output.length > 0 ? bounded(output.join(" · ")) : undefined;
};

export const presentExecution = (
  subject: ExecutionPresentationSubject,
): ExecutionSurfacePresentation => {
  const primaryLabel = executionPrimaryLabel(subject);
  const secondaryContext = executionSecondaryContext(subject);
  const presentation: ExecutionSurfacePresentation = { primaryLabel };
  if (secondaryContext) Object.assign(presentation, { secondaryContext });
  return presentation;
};
