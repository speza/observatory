import { Effect } from "effect";
import type { ObservatoryPlugin } from "../../../src/plugin-sdk/index.ts";

export const plugin: ObservatoryPlugin = {
  activate() {
    return {
      codeHosts: [
        {
          providerId: "example-code-host",
          supports: (repository) => repository.host === "forge.example",
          pullRequests: () => Effect.succeed([]),
        },
      ],
    };
  },
};
