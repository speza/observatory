import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ProviderHarnessId = "claude" | "codex" | "pi";

export const defaultProviderRoot = (harnessId: ProviderHarnessId, baseHome = homedir()): string => {
  if (harnessId === "claude") return join(baseHome, ".claude", "projects");
  if (harnessId === "codex") return join(baseHome, ".codex");
  return join(baseHome, ".pi", "agent");
};

export const providerScope = (harnessId: string, root: string): string =>
  createHash("sha256")
    .update(`${harnessId}\u0000${resolve(root)}`)
    .digest("hex")
    .slice(0, 24);

export const providerInstance = (harnessId: string, scope: string): string =>
  `${harnessId}-local-${scope}`;
