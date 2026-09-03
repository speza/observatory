import { Effect, Schema } from "effect";
import { timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentObservationReceiverInput } from "../plugin-sdk/index.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import type { AgentObservationModule } from "./types.ts";

const MAX_BODY_BYTES = 32 * 1024;
export const DEFAULT_PROVIDER_OBSERVATION_ENDPOINT =
  "http://127.0.0.1:4310/api/provider-observations";
export const defaultProviderObservationTokenPath = (baseHome = homedir()): string =>
  join(baseHome, ".local", "state", "observatory", "observation-token");
export const validProviderObservationToken = (value: string): boolean =>
  /^[A-Za-z0-9_-]{43,128}$/u.test(value);
const IngressEnvelopeSchema = Schema.Struct({
  harnessId: Schema.String,
  input: Schema.Record({
    key: Schema.String,
    value: Schema.Union(Schema.String, Schema.Number),
  }),
});
type IngressEnvelope = {
  readonly harnessId: string;
  readonly input: AgentObservationReceiverInput;
};

const authorized = (header: string | null, token: string): boolean => {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const suppliedBytes = Buffer.from(supplied);
  const tokenBytes = Buffer.from(token);
  return suppliedBytes.length === tokenBytes.length && timingSafeEqual(suppliedBytes, tokenBytes);
};

export class ProviderObservationIngress {
  private pending = Promise.resolve();

  constructor(
    private readonly token: string,
    private readonly harnesses: Pick<PluginRegistry, "agentHarness">,
    private readonly observations: AgentObservationModule,
  ) {
    if (!validProviderObservationToken(token))
      throw new Error("Provider observation ingress requires a strong token.");
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
    if (!authorized(request.headers.get("authorization"), this.token))
      return new Response("Unauthorized.", { status: 401 });
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json")
      return new Response("JSON required.", { status: 415 });
    const declaredSize = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES)
      return new Response("Payload too large.", { status: 413 });

    let envelope: IngressEnvelope;
    try {
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_BODY_BYTES)
        return new Response("Payload too large.", { status: 413 });
      envelope = Schema.decodeUnknownSync(Schema.parseJson(IngressEnvelopeSchema))(
        new TextDecoder().decode(bytes),
      );
    } catch {
      return new Response("Invalid observation.", { status: 400 });
    }

    const receiver = this.harnesses.agentHarness(envelope.harnessId)?.observationReceiver;
    if (!receiver) return new Response("Unknown observation source.", { status: 404 });

    let accepted = 0;
    let failed = false;
    this.pending = this.pending.then(async () => {
      try {
        accepted = await Effect.runPromise(receiver.receive(envelope.input));
        await Effect.runPromise(this.observations.refresh());
      } catch {
        failed = true;
      }
    });
    await this.pending;
    return failed
      ? new Response("Invalid observation.", { status: 400 })
      : Response.json({ accepted });
  }
}
