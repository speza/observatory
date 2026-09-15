import { Schema } from "effect";

/**
 * Terminal wire contract: socket and open-request limits, client and server
 * messages, and browser-safe links for host-provided companion terminals.
 */

/** Bounded generously enough for full-screen terminals on modern high-resolution displays. */
export const WEB_TERMINAL_DIMENSION_LIMITS = {
  minColumns: 1,
  maxColumns: 1_000,
  minRows: 1,
  maxRows: 500,
} as const;

export interface WebTerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

const boundedTerminalDimension = (value: number, minimum: number, maximum: number): number => {
  const integer = Number.isFinite(value) ? Math.trunc(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
};

/** Keep the browser grid and host PTY on the same safe dimensions at any viewport size. */
export const boundWebTerminalDimensions = (
  dimensions: WebTerminalDimensions,
): WebTerminalDimensions => ({
  columns: boundedTerminalDimension(
    dimensions.columns,
    WEB_TERMINAL_DIMENSION_LIMITS.minColumns,
    WEB_TERMINAL_DIMENSION_LIMITS.maxColumns,
  ),
  rows: boundedTerminalDimension(
    dimensions.rows,
    WEB_TERMINAL_DIMENSION_LIMITS.minRows,
    WEB_TERMINAL_DIMENSION_LIMITS.maxRows,
  ),
});

export const TerminalSessionIdSchema = Schema.String.pipe(Schema.pattern(/^[0-9a-f-]{36}$/u));
export const TerminalLinkIdSchema = Schema.String.pipe(Schema.pattern(/^[0-9a-f-]{36}$/u));

export const TerminalDimensionsSchema = Schema.Struct({
  columns: Schema.Number.pipe(
    Schema.int(),
    Schema.between(
      WEB_TERMINAL_DIMENSION_LIMITS.minColumns,
      WEB_TERMINAL_DIMENSION_LIMITS.maxColumns,
    ),
  ),
  rows: Schema.Number.pipe(
    Schema.int(),
    Schema.between(WEB_TERMINAL_DIMENSION_LIMITS.minRows, WEB_TERMINAL_DIMENSION_LIMITS.maxRows),
  ),
});
export type WebTerminalDimensionsData = Schema.Schema.Type<typeof TerminalDimensionsSchema>;

export const TerminalOpenRequestSchema = Schema.Struct({
  agentId: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160))),
  requestId: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240))),
  discoveryHandle: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(240))),
  dimensions: TerminalDimensionsSchema,
  resizeMode: Schema.optional(Schema.Literal("fit", "preserve")),
  linkId: Schema.optional(TerminalLinkIdSchema),
});

export const WebTerminalScrollRequestSchema = Schema.Struct({
  direction: Schema.Literal("up", "down"),
  lines: Schema.Number.pipe(Schema.int(), Schema.between(1, 512)),
  source: Schema.Literal("wheel", "page-key"),
});
export type WebTerminalScrollRequest = Schema.Schema.Type<typeof WebTerminalScrollRequestSchema>;

export const TerminalClientMessageSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("input"),
    value: Schema.String.pipe(Schema.maxLength(32_768)),
  }),
  Schema.Struct({
    kind: Schema.Literal("bytes"),
    bytes: Schema.Array(Schema.Number.pipe(Schema.int(), Schema.between(0, 255))).pipe(
      Schema.minItems(1),
      Schema.maxItems(32_768),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("scroll"),
    direction: WebTerminalScrollRequestSchema.fields.direction,
    lines: WebTerminalScrollRequestSchema.fields.lines,
    source: WebTerminalScrollRequestSchema.fields.source,
  }),
  Schema.Struct({
    kind: Schema.Literal("resize"),
    columns: TerminalDimensionsSchema.fields.columns,
    rows: TerminalDimensionsSchema.fields.rows,
  }),
);
export type WebTerminalClientMessage = Schema.Schema.Type<typeof TerminalClientMessageSchema>;

export const WebTerminalEventSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("frame"),
    deliveryId: Schema.Number,
    bytes: Schema.String,
    columns: Schema.optional(Schema.Number),
    rows: Schema.optional(Schema.Number),
    sequence: Schema.optional(Schema.Number),
    full: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("closed"),
    deliveryId: Schema.optional(Schema.Number),
    reason: Schema.optional(Schema.String),
  }),
);
export type WebTerminalEvent = Schema.Schema.Type<typeof WebTerminalEventSchema>;

export const WebTerminalServerMessageSchema = Schema.Union(
  WebTerminalEventSchema,
  Schema.Struct({ kind: Schema.Literal("error"), message: Schema.String }),
);
export type WebTerminalServerMessage = Schema.Schema.Type<typeof WebTerminalServerMessageSchema>;

/** A browser-safe handle for a host-provided companion terminal. */
export const WebTerminalLinkSchema = Schema.Struct({
  /** Opaque to the browser; the server resolves it back to a host execution. */
  id: Schema.String,
  kind: Schema.Literal("shell", "agent"),
  label: Schema.String,
  source: Schema.Literal("observed", "prepared"),
  available: Schema.Boolean,
  explanation: Schema.String,
});
export type WebTerminalLink = Schema.Schema.Type<typeof WebTerminalLinkSchema>;

export const WebTerminalLinksResponseSchema = Schema.Struct({
  kind: Schema.Literal("terminal-links"),
  agentId: Schema.String,
  agentName: Schema.String,
  links: Schema.Array(WebTerminalLinkSchema),
  message: Schema.optional(Schema.String),
});
export type WebTerminalLinksResponse = Schema.Schema.Type<typeof WebTerminalLinksResponseSchema>;

export const WebTerminalActionResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  message: Schema.String,
});
export type WebTerminalActionResponse = Schema.Schema.Type<typeof WebTerminalActionResponseSchema>;

export const TerminalOpenResponseSchema = Schema.Struct({
  sessionId: Schema.String,
  message: Schema.String,
});
export type WebTerminalOpenResponse = Schema.Schema.Type<typeof TerminalOpenResponseSchema>;
