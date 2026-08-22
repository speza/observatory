#!/usr/bin/env bun

/**
 * THROWAWAY PROTOTYPE — do not import this into Observatory.
 *
 * Question: can one map-adjacent interaction surface feel useful across the
 * capability levels we will meet in real agent hosts?
 *
 * The fixtures deliberately cover native chat, transcript-backed chat,
 * terminal-only access and read-only observation. There is no host process,
 * persistence or real transcript here; the point is to feel the product
 * contract before we decide whether those seams belong in production.
 */

type Mode = "browse" | "compose" | "launch" | "terminal";
type Capability = "native-chat" | "transcript-chat" | "terminal-only" | "read-only";
type Author = "you" | "agent" | "system";

interface Message {
  readonly author: Author;
  readonly body: string;
}

interface Session {
  readonly id: string;
  readonly title: string;
  readonly provider: string;
  readonly host: string;
  readonly capability: Capability;
  readonly status: "working" | "waiting" | "blocked" | "idle";
  readonly transcriptSource: string;
  readonly messages: Message[];
}

interface State {
  readonly sessions: Session[];
  selected: number;
  mode: Mode;
  draft: string;
  notice: string;
  frame: number;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";

const capabilityLabel: Record<Capability, string> = {
  "native-chat": "CHAT",
  "transcript-chat": "TRANSCRIPT",
  "terminal-only": "TERMINAL",
  "read-only": "READ ONLY",
};

const capabilityColour: Record<Capability, string> = {
  "native-chat": GREEN,
  "transcript-chat": CYAN,
  "terminal-only": YELLOW,
  "read-only": DIM,
};

function session(
  id: string,
  title: string,
  provider: string,
  host: string,
  capability: Capability,
  status: Session["status"],
  transcriptSource: string,
  messages: Message[],
): Session {
  return { id, title, provider, host, capability, status, transcriptSource, messages };
}

const state: State = {
  sessions: [
    session("chief", "chief-of-staff", "Codex", "Herdr", "native-chat", "working", "provider API", [
      { author: "agent", body: "I found three sessions that need a decision." },
      { author: "system", body: "Native conversation channel is available." },
    ]),
    session(
      "review",
      "router-review",
      "Claude Code",
      "Herdr",
      "transcript-chat",
      "waiting",
      "local transcript + input hook",
      [
        { author: "agent", body: "The implementation is ready for human review." },
        { author: "system", body: "Messages are queued through the transcript hook." },
      ],
    ),
    session(
      "shell",
      "migration-shell",
      "PI",
      "tmux",
      "terminal-only",
      "working",
      "terminal pane only",
      [{ author: "agent", body: "I am running a long migration command." }],
    ),
    session(
      "ghost",
      "old-ghostty-tab",
      "OpenCode",
      "Ghostty",
      "read-only",
      "idle",
      "metadata snapshot only",
      [{ author: "system", body: "This host exposes identity, but no safe input or transcript." }],
    ),
  ],
  selected: 0,
  mode: "browse",
  draft: "",
  notice: "Select a session, then try m, t, r or n.",
  frame: 0,
};

function selectedSession(): Session {
  return state.sessions[state.selected]!;
}

function statusColour(status: Session["status"]): string {
  if (status === "working") return GREEN;
  if (status === "blocked") return RED;
  if (status === "waiting") return YELLOW;
  return DIM;
}

function writeLine(value = ""): void {
  process.stdout.write(`${value}\n`);
}

function render(): void {
  const current = selectedSession();
  const width = Math.max(72, Math.min(process.stdout.columns || 100, 120));
  const divider = `${DIM}${"─".repeat(width)}${RESET}`;

  process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
  writeLine(`${BOLD}${CYAN}OBSERVATORY / INTERACTION POC${RESET} ${DIM}throwaway${RESET}`);
  writeLine(
    `${DIM}Question: can one surface support chat, transcript context, terminal access and launch?${RESET}`,
  );
  writeLine(divider);
  writeLine(`${BOLD}SESSIONS${RESET} ${DIM}(synthetic host capabilities)${RESET}`);
  for (const [index, item] of state.sessions.entries()) {
    const pointer = index === state.selected ? `${CYAN}▸${RESET}` : " ";
    const capability = `${capabilityColour[item.capability]}${capabilityLabel[item.capability]}${RESET}`;
    writeLine(
      `${pointer} ${index + 1}. ${index === state.selected ? BOLD : ""}${item.title.padEnd(22)}${RESET} ` +
        `${statusColour(item.status)}${item.status.padEnd(8)}${RESET} ${capability}`,
    );
  }
  writeLine(divider);
  writeLine(
    `${BOLD}${current.title}${RESET}  ${DIM}${current.provider} · ${current.host} · ${current.id}${RESET}`,
  );
  writeLine(
    `capability ${capabilityColour[current.capability]}${capabilityLabel[current.capability]}${RESET}  ` +
      `transcript ${DIM}${current.transcriptSource}${RESET}`,
  );
  writeLine(divider);
  writeLine(`${BOLD}TRANSCRIPT${RESET}`);
  for (const message of current.messages.slice(-7)) {
    const label =
      message.author === "you"
        ? `${MAGENTA}you${RESET}`
        : message.author === "agent"
          ? `${BLUE}agent${RESET}`
          : `${DIM}system${RESET}`;
    writeLine(`  ${label.padEnd(17)} ${message.body}`);
  }
  if (state.mode === "compose") {
    writeLine(divider);
    writeLine(`${BOLD}${MAGENTA}MESSAGE${RESET} ${DIM}Enter sends · Esc cancels${RESET}`);
    writeLine(`  ${state.draft}${CYAN}▌${RESET}`);
  }
  if (state.mode === "launch") {
    writeLine(divider);
    writeLine(`${BOLD}${YELLOW}NEW SESSION${RESET} ${DIM}choose a synthetic capability${RESET}`);
    writeLine("  1  native chat       2  transcript + hook");
    writeLine("  3  terminal only     4  read-only observer");
  }
  if (state.mode === "terminal") {
    writeLine(divider);
    writeLine(`${BOLD}${YELLOW}TERMINAL TAKEOVER (SIMULATED)${RESET}`);
    writeLine(`${DIM}This is the fallback when AO cannot provide a conversation surface.${RESET}`);
    writeLine(`${DIM}Press Esc to return to the universe.${RESET}`);
  }
  writeLine(divider);
  writeLine(`${BOLD}STATUS${RESET} ${state.notice}`);
  writeLine(
    `${DIM}[j/k] select  [m] message  [r] refresh transcript  [t] terminal  [n] new session  [q] quit${RESET}`,
  );
  state.frame += 1;
}

function addMessage(item: Session, message: Message): void {
  item.messages.push(message);
}

function enterCompose(): void {
  const item = selectedSession();
  if (item.capability === "native-chat" || item.capability === "transcript-chat") {
    state.mode = "compose";
    state.draft = "";
    state.notice = `Composing a message to ${item.title}.`;
    return;
  }
  state.notice =
    item.capability === "terminal-only"
      ? "No message channel. Use t to open the terminal instead."
      : "Read-only session: no message or terminal channel is available.";
}

function sendMessage(): void {
  const item = selectedSession();
  const body = state.draft.trim();
  if (!body) {
    state.notice = "Empty message discarded.";
    state.mode = "browse";
    return;
  }
  addMessage(item, { author: "you", body });
  if (item.capability === "native-chat") {
    addMessage(item, { author: "agent", body: "Received immediately through the native channel." });
    state.notice = "Message delivered; native reply returned in the same surface.";
  } else {
    addMessage(item, {
      author: "system",
      body: "Queued for the transcript/input hook; delivery is observable.",
    });
    state.notice = "Message queued; this is the point where a real hook must prove reliability.";
  }
  state.draft = "";
  state.mode = "browse";
}

function refreshTranscript(): void {
  const item = selectedSession();
  if (item.capability === "read-only") {
    state.notice = "This session has no transcript locator; metadata only.";
    return;
  }
  addMessage(item, {
    author: "system",
    body: `Transcript refreshed from ${item.transcriptSource}.`,
  });
  state.notice = "Transcript context refreshed without leaving the map surface.";
}

function beginTerminal(): void {
  const item = selectedSession();
  if (item.capability === "read-only") {
    state.notice = "No terminal target is known for this session.";
    return;
  }
  state.mode = "terminal";
  state.notice = `Attached to ${item.title}; in production this would hand the TTY to the host.`;
}

function createSession(choice: string): void {
  const definitions: Record<string, [Capability, string, string]> = {
    "1": ["native-chat", "Codex", "provider API"],
    "2": ["transcript-chat", "Claude Code", "local transcript + input hook"],
    "3": ["terminal-only", "PI", "terminal pane only"],
    "4": ["read-only", "OpenCode", "metadata snapshot only"],
  };
  const definition = definitions[choice];
  if (!definition) {
    state.notice = "Choose 1, 2, 3 or 4; Esc cancels.";
    return;
  }
  const [capability, provider, transcriptSource] = definition;
  const id = `new-${state.sessions.length + 1}`;
  state.sessions.push(
    session(
      id,
      `new-${provider.toLowerCase().replaceAll(" ", "-")}`,
      provider,
      "mock host",
      capability,
      "waiting",
      transcriptSource,
      [{ author: "system", body: "Launch requested from Observatory." }],
    ),
  );
  state.selected = state.sessions.length - 1;
  state.mode = "browse";
  state.notice = `Created ${state.sessions[state.selected]!.title}; the host would now start it.`;
}

function handleBrowse(input: string): void {
  if (input === "j") {
    state.selected = (state.selected + 1) % state.sessions.length;
    state.notice = `Selected ${selectedSession().title}.`;
  } else if (input === "k") {
    state.selected = (state.selected - 1 + state.sessions.length) % state.sessions.length;
    state.notice = `Selected ${selectedSession().title}.`;
  } else if (input === "m") {
    enterCompose();
  } else if (input === "r") {
    refreshTranscript();
  } else if (input === "t") {
    beginTerminal();
  } else if (input === "n") {
    state.mode = "launch";
    state.notice = "Choose the capability you want the new host session to expose.";
  }
}

function handleInput(input: string): void {
  if (input === "\u0003" || (input === "q" && state.mode === "browse")) {
    shutdown();
    return;
  }
  if (state.mode === "browse") {
    handleBrowse(input);
  } else if (state.mode === "compose") {
    if (input === "\u001b") {
      state.mode = "browse";
      state.draft = "";
      state.notice = "Message cancelled.";
    } else if (input === "\r" || input === "\n") {
      sendMessage();
    } else if (input === "\u007f" || input === "\b") {
      state.draft = state.draft.slice(0, -1);
    } else if (input >= " " && input <= "~") {
      state.draft += input;
    }
  } else if (state.mode === "launch") {
    if (input === "\u001b") {
      state.mode = "browse";
      state.notice = "New session cancelled.";
    } else {
      createSession(input);
    }
  } else if (state.mode === "terminal" && input === "\u001b") {
    state.mode = "browse";
    state.notice = "Returned from terminal access; the universe remains available.";
  }
  render();
}

function shutdown(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write(`\x1b[?25h\x1b[0m\n${DIM}interaction POC ended${RESET}\n`);
  process.exit(0);
}

if (!process.stdin.isTTY) {
  throw new Error("Run this prototype in an interactive terminal.");
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  // Arrow sequences are intentionally ignored; j/k are the only navigation
  // keys in this throwaway shell so the interaction remains easy to inspect.
  for (const input of chunk.replaceAll("\u001b[A", "").replaceAll("\u001b[B", "")) {
    handleInput(input);
  }
});
process.on("SIGINT", shutdown);
render();
