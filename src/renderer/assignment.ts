import type { SessionView } from "../projection/types.ts";

const searchable = (value: string | undefined): string => value?.toLocaleLowerCase() ?? "";

/** Return inbox sessions matching the short query used by the assignment picker. */
export const filterAssignableSessions = (
  sessions: readonly SessionView[],
  query: string,
): readonly SessionView[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return sessions;
  return sessions.filter((session) =>
    [
      session.displayName,
      session.description,
      session.runtimeState,
      session.provider,
      session.repository,
      session.branch,
      session.worktree,
    ]
      .map(searchable)
      .some((value) => value.includes(normalized)),
  );
};
