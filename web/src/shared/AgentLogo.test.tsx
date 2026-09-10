import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentLogo, agentBrandFor } from "./AgentLogo.tsx";

describe("AgentLogo", () => {
  test("recognises supported harness identities without guessing unknown providers", () => {
    expect(agentBrandFor("claude")).toBe("claude");
    expect(agentBrandFor("codex-cli")).toBe("codex");
    expect(agentBrandFor("opencode")).toBe("opencode");
    expect(agentBrandFor("pi")).toBe("pi");
    expect(agentBrandFor(undefined, "openai")).toBe("codex");
    expect(agentBrandFor("custom", "openai")).toBe("generic");
  });

  test("renders branded marks in their source colours", () => {
    const claude = renderToStaticMarkup(<AgentLogo harnessId="claude" />);
    const codex = renderToStaticMarkup(<AgentLogo harnessId="codex" />);
    const opencode = renderToStaticMarkup(<AgentLogo harnessId="opencode" />);
    const pi = renderToStaticMarkup(<AgentLogo harnessId="pi" />);

    expect(claude).toContain('data-agent-brand="claude"');
    expect(claude).toContain('viewBox="-5 -5 110 110"');
    expect(codex).toContain('viewBox="160 160 395 395"');
    expect(opencode).toContain('data-agent-brand="opencode"');
    expect(opencode).toContain(
      'class="agent-logo__opencode agent-logo__opencode--light" href="/opencode-logo-light.svg"',
    );
    expect(opencode).toContain(
      'class="agent-logo__opencode agent-logo__opencode--dark" href="/opencode-logo-dark.svg"',
    );
    expect(opencode).toContain('viewBox="0 0 240 300"');
    expect(pi).toContain('viewBox="140 140 520 520"');
    expect(pi).toContain("517.36");
    expect(claude).toContain('aria-hidden="true"');
    expect(claude).toContain('fill="#D97757"');
    expect(codex).toContain('fill="var(--agent-logo-monochrome, #000000)"');
    expect(pi).toContain('fill="var(--agent-logo-monochrome, #000000)"');
    expect(claude).not.toContain('fill="currentColor"');
    expect(codex).not.toContain('fill="currentColor"');
    expect(pi).not.toContain('fill="currentColor"');
  });
});
