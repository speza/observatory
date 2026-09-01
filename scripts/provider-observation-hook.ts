import { Schema } from "effect";
import {
  ProviderHookInputSchema,
  recordProviderHook,
  type ProviderHarnessId,
} from "../plugins/agent-harnesses/provider-observation-hook.ts";

const harnessId = process.argv[2];
if (harnessId !== "claude" && harnessId !== "codex") process.exit(2);

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const MAX_INPUT_BYTES = 1024 * 1024;
let input = "";
let inputBytes = 0;
let tooLarge = false;
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  inputBytes += chunk.byteLength;
  if (inputBytes > MAX_INPUT_BYTES) {
    tooLarge = true;
    break;
  }
  input += decoder.decode(chunk, { stream: true });
}
input += decoder.decode();

try {
  if (tooLarge) throw new Error("Provider hook input exceeded the safe limit.");
  const decoded = Schema.decodeUnknownSync(Schema.parseJson(ProviderHookInputSchema))(input);
  await recordProviderHook(harnessId satisfies ProviderHarnessId, decoded, {
    outbox: argument("--outbox"),
    providerRoot: argument("--provider-root"),
  });
} catch {
  // Hooks are enrichment only. Invalid input must not interrupt the provider.
}
