import { Effect } from "effect";
import type { ObservatoryPlugin } from "../../../plugin-sdk/index.ts";

export const plugin: ObservatoryPlugin = {
  activate(_context) {
    return {
      codeHosts: [
        {
          providerId: "synthetic",
          supports: (repository) => repository.host === "code.example",
          pullRequests: (revision) =>
            Effect.succeed([
              {
                providerId: "synthetic",
                repository: revision.repository,
                number: 7,
                url: "https://code.example/acme/observatory/pull/7",
                title: "Synthetic status",
                state: "open",
                draft: false,
                baseBranch: "main",
                headBranch: revision.branch,
                head: revision.head,
                checks: "passing",
                review: "approved",
                mergeability: "mergeable",
              },
            ]),
        },
      ],
    };
  },
};
