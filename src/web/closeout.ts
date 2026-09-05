import { Schema } from "effect";

const MAX_REQUEST_BYTES = 16_384;
const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));
const CloseoutRequestSchema = Schema.Struct({
  agentIds: Schema.Array(Id).pipe(Schema.minItems(1), Schema.maxItems(100)),
});

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
    return Schema.decodeUnknownSync(Schema.parseJson(CloseoutRequestSchema))(encoded).agentIds;
  } catch {
    throw new WebCloseoutError("Closeout request does not match the command contract.", 400);
  }
};
