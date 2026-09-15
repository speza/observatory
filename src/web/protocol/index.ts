/**
 * The web wire contract: the single server-owned vocabulary for everything that
 * crosses the browser↔server boundary. Schemas are the source of truth;
 * TypeScript types derive from them. The contract composes only the projection
 * module's transport-neutral view types — see docs/design/web-wire-contract.md.
 */
export * from "./commands.ts";
export * from "./views.ts";
export * from "./auxiliary.ts";
export * from "./terminal.ts";
export * from "./vocabulary.ts";

/**
 * Reserved System receiving Goals created without an explicit System. Deliberate
 * contract-owned mirror of the domain constant (spec decision D1): the renderer
 * reads it from the contract, never from the domain.
 */
export const DEFAULT_SYSTEM_ID = "system:default";
