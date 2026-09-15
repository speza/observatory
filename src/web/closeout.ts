import { Schema } from "effect";
import { WebCloseoutRequestSchema } from "./protocol/index.ts";

const MAX_REQUEST_BYTES = 16_384;

export class WebCloseoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const decodeWebCloseoutRequest = (encoded: string): readonly string[] => {
  if (encoded.length > MAX_REQUEST_BYTES)
    throw new WebCloseoutError("Closeout request is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(WebCloseoutRequestSchema))(encoded).agentIds;
  } catch {
    throw new WebCloseoutError("Closeout request does not match the command contract.", 400);
  }
};
