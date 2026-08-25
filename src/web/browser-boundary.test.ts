import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("web browser boundary", () => {
  test("does not import persistence, host adapters or the mutable Universe", () => {
    const root = join(import.meta.dir, "../../web/src");
    const files = new Bun.Glob("**/*.{ts,tsx}").scanSync({
      cwd: root,
      absolute: true,
      onlyFiles: true,
    });
    const forbidden = ["persistence/", "hosts/herdr", "hosts/mock", "universe/universe"];

    for (const path of files) {
      if (path.includes(".test.")) continue;
      const source = readFileSync(path, "utf8");
      for (const fragment of forbidden) expect(source).not.toContain(fragment);
    }
  });
});
