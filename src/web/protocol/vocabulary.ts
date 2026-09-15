import { Schema } from "effect";

/**
 * Shared wire vocabulary owned by the web contract. The domain declares its own
 * equal tokens; gateways map between them, so no internal module type crosses
 * the wire by reference.
 */

/** Ordered goal-priority vocabulary; P0 is most urgent. */
export const WEB_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type WebPriority = (typeof WEB_PRIORITIES)[number];
export const WebPrioritySchema = Schema.Literal("P0", "P1", "P2", "P3");
