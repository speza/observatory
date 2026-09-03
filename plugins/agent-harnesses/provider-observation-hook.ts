import { Schema } from "effect";
import { readFile, stat } from "node:fs/promises";
import {
  validObservationEndpoint,
  type ProviderHarnessId,
} from "./provider-observation-installation.ts";
import { ProviderHookInputSchema, type ProviderHookInput } from "./provider-observation-events.ts";

const MAX_HOOK_BODY_BYTES = 32 * 1024;
const DELIVERY_TIMEOUT_MS = 200;

export { ProviderHookInputSchema, type ProviderHookInput };

export interface RecordProviderHookOptions {
  readonly endpoint?: string;
  readonly tokenFile?: string;
}

export const recordProviderHook = async (
  harnessId: ProviderHarnessId,
  input: ProviderHookInput,
  options: RecordProviderHookOptions = {},
): Promise<number> => {
  if (!options.endpoint || !validObservationEndpoint(options.endpoint) || !options.tokenFile)
    return 0;
  let token: string;
  try {
    const metadata = await stat(options.tokenFile);
    if (!metadata.isFile() || metadata.size > 256 || (metadata.mode & 0o077) !== 0) return 0;
    token = (await readFile(options.tokenFile, "utf8")).trim();
  } catch {
    return 0;
  }
  if (!token) return 0;
  const body = JSON.stringify({ harnessId, input });
  if (Buffer.byteLength(body, "utf8") > MAX_HOOK_BODY_BYTES) return 0;
  try {
    const response = await fetch(options.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (!response.ok) return 0;
    const decoded = Schema.decodeUnknownSync(
      Schema.parseJson(Schema.Struct({ accepted: Schema.Number })),
    )(await response.text());
    return decoded.accepted;
  } catch {
    return 0;
  }
};
