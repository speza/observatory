// PROTOTYPE: remove or replace with a contributed capability if voice input proves useful.

import { Schema } from "effect";

const RealtimeTokenSchema = Schema.Struct({ token: Schema.String });

export class SpeechToTextPrototype {
  constructor(private readonly apiKey: string) {}

  async createRealtimeToken(): Promise<Response> {
    try {
      const response = await fetch(
        "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
        { method: "POST", headers: { "xi-api-key": this.apiKey } },
      );
      if (!response.ok) {
        console.error(`ElevenLabs realtime token request failed (${response.status}).`);
        return this.error(`Realtime speech connection failed (${response.status}).`, 502);
      }
      const { token } = Schema.decodeUnknownSync(RealtimeTokenSchema)(await response.json());
      return Response.json(
        { token },
        { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
      );
    } catch {
      return this.error("Realtime speech service is unavailable.", 502);
    }
  }

  private error(message: string, status: number): Response {
    return Response.json(
      { error: message },
      {
        status,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      },
    );
  }
}
