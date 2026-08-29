import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentLogo, agentBrandFor } from "./AgentLogo.tsx";

describe("AgentLogo", () => {
  test("recognises supported harness identities without guessing unknown providers", () => {
    expect(agentBrandFor("claude")).toBe("claude");
    expect(agentBrandFor("codex-cli")).toBe("codex");
    expect(agentBrandFor("pi")).toBe("pi");
    expect(agentBrandFor(undefined, "openai")).toBe("codex");
    expect(agentBrandFor("custom", "openai")).toBe("generic");
  });

  test("renders a branded, decorative mark", () => {
    const claude = renderToStaticMarkup(<AgentLogo harnessId="claude" />);
    const codex = renderToStaticMarkup(<AgentLogo harnessId="codex" />);
    const pi = renderToStaticMarkup(<AgentLogo harnessId="pi" />);

    expect(claude).toContain('data-agent-brand="claude"');
    expect(claude).toContain('viewBox="-5 -5 110 110"');
    expect(codex).toContain('viewBox="160 160 395 395"');
    expect(pi).toContain('viewBox="140 140 520 520"');
    expect(pi).toContain("517.36");
    expect(claude).toContain('aria-hidden="true"');
  });
});
