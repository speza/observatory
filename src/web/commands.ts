import { Schema } from "effect";
import { WebCommandSchema, type WebCommand } from "./protocol/index.ts";

const MAX_COMMAND_BYTES = 16_384;

export class WebCommandError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const decodeWebCommand = (text: string): WebCommand => {
  if (text.length > MAX_COMMAND_BYTES) throw new WebCommandError("Command body is too large.", 413);
  try {
    return Schema.decodeUnknownSync(Schema.parseJson(WebCommandSchema))(text);
  } catch {
    throw new WebCommandError("Command body does not match the web command contract.", 400);
  }
};
