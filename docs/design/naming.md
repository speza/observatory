# Observatory naming decision

Status: decided

Date: 2026-08-22

## What the name must communicate

The product exists to help a human understand and direct a large body of AI
agent work. It is not primarily an agent runtime, model-observability platform
or terminal multiplexer.

A strong name should:

- feel natural as a terminal-native developer tool;
- suggest orientation, attention and comprehension;
- remain provider-independent;
- avoid implying that spawning more agents is itself the objective;
- survive changes to the exact visual metaphor;
- support a short, memorable command; and
- be distinctive enough to find and discuss.

## Leading candidates

### Observatory

**Observatory** describes the product's purpose: a place from which a human can
see a complex system, understand its state and decide where to direct attention.

It is calm and supervisory rather than aggressively autonomous. It also avoids
claiming that the product owns the agents or their terminal sessions.

Presentation:

```text
Observatory
See all the work.
```

The product name does not need the word `Agent`. The category explanation can
carry it instead:

> A terminal-native observatory for AI agent work.

The existing `ao` codename remains a strong executable name and can be read as
`Agent Observatory` without requiring that expansion in the public brand.

Strengths:

- directly expresses orientation and comprehension;
- gives the human a clear place in the metaphor;
- remains valid if the interface becomes less explicitly planetary;
- supports visual language around telescopes, signals and celestial systems;
- distinguishes AO from tools primarily selling autonomous execution.

Risks:

- the word is already widely used in software;
- it may initially sound read-only;
- AI observability projects already use the name and adjacent language;
- a generic name will require a distinctive organisation, domain and package
  strategy.

### Orbital

**Orbital** describes the experience of the interface: goals, agent sessions and
repositories arranged as a changing spatial system.

Candidate presentation:

```text
Orbital
Keep your agents in view.
```

`orb` would be an excellent terminal command if available.

Strengths:

- energetic, modern and visually suggestive;
- sounds like a polished native developer tool;
- naturally supports motion, hierarchy and relationships;
- shorter and more immediately brand-like than Observatory.

Risks:

- may constrain the product to the planetary metaphor;
- communicates appearance more strongly than the human problem being solved;
- is likely to be commercially and technically crowded;
- may be confused with infrastructure, deployment or aerospace products.

### Orrery

An **orrery** is a mechanical model of celestial bodies and their orbits. It is
an unusually exact description of the proposed spatial interface: goals as
major bodies, with agent sessions arranged around them.

Candidate presentation:

```text
Orrery
Your agents, in orbit.
```

Strengths:

- distinctive and unusually faithful to the interface;
- memorable once understood;
- visually rich and ownable in tone.

Risks:

- unfamiliar to many users;
- harder to pronounce and spell;
- describes the visual object rather than the broader supervisory product.

## Decision

The product name is **Observatory**. Its plain-language category is **an agent
observatory**. The product does not need `Agent` in its name.

`ao` remains the executable name, repository codename and environment-variable
prefix. It may be read as `Agent Observatory`, but that expansion is not part of
the public product name.

## Candidate ranking record

The present ranking by product meaning is:

1. **Observatory**
2. **Orbital**
3. **Orrery**

The ranking by terminal-brand energy is:

1. **Orbital**
2. **Observatory**
3. **Orrery**

A promising vocabulary is:

```text
Observatory                 product
ao                          executable and repository codename
Orrery                      spatial overview
Orbital                     automatic spatial layout mode
Attention                   ranked human-intervention view
Inspector                   focused object detail
```

The product and executable names are settled. Orrery, Orbital and the remaining
interface vocabulary are still optional and should not be embedded deeply
without a separate product decision.

## Existing GitHub landscape

The bare name `Observatory` is not unique on GitHub. The most relevant semantic
collision is [The Context Company Observatory](https://github.com/The-Context-Company/observatory),
which provides AI-agent observability packages for traces and instrumentation.
[TransluceAI Observatory](https://github.com/TransluceAI/observatory) concerns
understanding and steering model internals. There are also several smaller
projects using `agent-observatory` for telemetry, performance and cost
monitoring.

The broader agent-session-management category is increasingly active:

- [Agent Deck](https://github.com/asheshgoplani/agent-deck) manages multi-provider
  sessions, groups, worktrees, status and cost;
- [Cogitator](https://github.com/guilhermehto/cogitator) surfaces agent attention
  and worktrees through a TUI;
- [CCManager](https://github.com/kbwo/ccmanager) manages multiple coding-agent
  providers and worktrees;
- [Agent Manager](https://github.com/YoanWai/agent-manager) provides grouped
  sessions, status, prompting and diff review;
- [aimux](https://github.com/zanetworker/aimux) combines session management with
  tracing, cost and code review;
- [Stoneforge](https://github.com/stoneforge-ai/stoneforge) owns a more autonomous
  orchestration runtime; and
- [AI Maestro](https://github.com/23blocks-OS/ai-maestro) focuses on multi-machine
  orchestration and agent messaging.

No project found in the initial search clearly combines AO's complete thesis:
durable cross-repository goals, stable spatial organisation, delegation and Git
relationships, explainable human attention, provider-independent hosted
sessions and a terminal-native universe.

That is an initial landscape scan, not exhaustive market or legal diligence.

## Names to avoid

- **Mission Control** is heavily overloaded and implies execution ownership.
- **AgentOS** suggests that the product owns the runtime.
- **Swarm**, **Fleet** and **Hive** celebrate concurrency rather than human
  comprehension and judgment.
- **Constellation** is accurate but highly generic.

## Clearance before commitment

Before publishing a final name:

1. search GitHub repositories, organisations and active products;
2. check command names and packages across npm, crates.io and Homebrew;
3. check useful domains and social identifiers;
4. search relevant UK, US and international trademarks;
5. examine adjacent developer-tools and AI-agent products, not only exact-name
   matches; and
6. test the name aloud with prospective users.

Use **Observatory** as the product name and **an agent observatory** as its
category description. Retain **AO** as the stable internal codename while
clearance work determines publication, organisation and package strategy.
