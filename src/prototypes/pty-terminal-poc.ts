/**
 * THROWAWAY PROTOTYPE — Observatory-owned PTY terminal surface.
 *
 * This deliberately does not introduce a production terminal abstraction.
 * It answers one narrow question: can Bun's PTY plus a small VT screen model
 * make a useful, native-feeling terminal panel inside the OpenTUI map shell?
 *
 * Run with:
 *   bun run dev:pty-poc
 *
 * To try another real CLI, pass a JSON argv array:
 *   AO_PTY_POC_ARGV='["bash","-lc","git status; exec bash"]' bun run dev:pty-poc
 *
 * Controls are intentionally terminal-first. Ctrl-Q leaves the POC; every
 * other key, including Ctrl-C and Escape, is sent to the child PTY.
 */

import {
  BoxRenderable,
  createCliRenderer,
  RGBA,
  StyledText,
  TextAttributes,
  TextRenderable,
  type TextChunk,
} from "@opentui/core";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const MIN_COLUMNS = 24;
const MIN_ROWS = 8;

const COLORS = {
  background: RGBA.fromHex("#08131f"),
  panel: RGBA.fromHex("#0d1d2b"),
  panelRaised: RGBA.fromHex("#10283a"),
  border: RGBA.fromHex("#28536a"),
  borderStrong: RGBA.fromHex("#65c7df"),
  text: RGBA.fromHex("#dcecf2"),
  muted: RGBA.fromHex("#8aa6b4"),
  faint: RGBA.fromHex("#527183"),
  cyan: RGBA.fromHex("#67e8f9"),
  green: RGBA.fromHex("#86efac"),
  yellow: RGBA.fromHex("#fde68a"),
  orange: RGBA.fromHex("#fdba74"),
  red: RGBA.fromHex("#fb7185"),
} as const;

type Cell = {
  char: string;
  fg: RGBA;
  bg: RGBA;
  attributes: number;
};

type Cursor = { x: number; y: number };

type SavedScreen = {
  cells: Cell[][];
  cursor: Cursor;
  savedCursor: Cursor;
};

const cloneColor = (value: RGBA): RGBA => RGBA.clone(value);

const cloneCell = (cell: Cell): Cell => ({
  char: cell.char,
  fg: cloneColor(cell.fg),
  bg: cloneColor(cell.bg),
  attributes: cell.attributes,
});

const cloneGrid = (grid: Cell[][]): Cell[][] => grid.map((row) => row.map(cloneCell));

const blankCell = (fg: RGBA, bg: RGBA): Cell => ({
  char: " ",
  fg: cloneColor(fg),
  bg: cloneColor(bg),
  attributes: TextAttributes.NONE,
});

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const ansiPalette = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
].map((hex) => RGBA.fromHex(hex));

const ansiColourChannel = (value: number): number => (value === 0 ? 0 : 55 + value * 40);

const ansi256 = (index: number): RGBA => {
  if (index < 16) return cloneColor(ansiPalette[clamp(index, 0, 15)]!);
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10;
    return RGBA.fromInts(grey, grey, grey);
  }
  const colour = index - 16;
  const red = Math.floor(colour / 36);
  const green = Math.floor((colour % 36) / 6);
  const blue = colour % 6;
  return RGBA.fromInts(ansiColourChannel(red), ansiColourChannel(green), ansiColourChannel(blue));
};

const defaultStyle = () => ({
  fg: cloneColor(COLORS.text),
  bg: cloneColor(COLORS.background),
  attributes: TextAttributes.NONE,
});

type Style = ReturnType<typeof defaultStyle>;

const styleEqual = (left: Cell, right: Cell): boolean =>
  left.fg.equals(right.fg) && left.bg.equals(right.bg) && left.attributes === right.attributes;

/** A deliberately small VT100/xterm-ish screen model for this experiment. */
export class PseudoTerminalScreen {
  private columnCount: number;
  private rowCount: number;
  private cells: Cell[][];
  private alternate: SavedScreen | undefined;
  private cursor: Cursor = { x: 0, y: 0 };
  private savedCursor: Cursor = { x: 0, y: 0 };
  private style: Style = defaultStyle();
  private parserState: "normal" | "escape" | "csi" | "osc" = "normal";
  private csiBuffer = "";
  private oscBuffer = "";
  private oscEscaped = false;
  private wrapPending = false;
  private cursorVisible = true;
  private decoder = new TextDecoder();
  private byteCount = 0;
  private ansiSequenceCount = 0;
  private isAlternateScreen = false;

  constructor(columns = DEFAULT_COLUMNS, rows = DEFAULT_ROWS) {
    this.columnCount = Math.max(MIN_COLUMNS, columns);
    this.rowCount = Math.max(MIN_ROWS, rows);
    this.cells = this.createGrid();
  }

  get columns(): number {
    return this.columnCount;
  }

  get rows(): number {
    return this.rowCount;
  }

  get bytes(): number {
    return this.byteCount;
  }

  get ansiSequences(): number {
    return this.ansiSequenceCount;
  }

  get alternateScreen(): boolean {
    return this.isAlternateScreen;
  }

  get position(): Cursor {
    return { ...this.cursor };
  }

  resize(columns: number, rows: number): void {
    const nextColumns = Math.max(MIN_COLUMNS, columns);
    const nextRows = Math.max(MIN_ROWS, rows);
    if (nextColumns === this.columnCount && nextRows === this.rowCount) return;
    const next = this.createGrid(nextColumns, nextRows);
    for (let y = 0; y < Math.min(this.rowCount, nextRows); y += 1) {
      for (let x = 0; x < Math.min(this.columnCount, nextColumns); x += 1) {
        next[y]![x] = cloneCell(this.cells[y]![x]!);
      }
    }
    this.columnCount = nextColumns;
    this.rowCount = nextRows;
    this.cells = next;
    this.cursor.x = clamp(this.cursor.x, 0, this.columnCount - 1);
    this.cursor.y = clamp(this.cursor.y, 0, this.rowCount - 1);
    this.wrapPending = false;
    if (this.alternate) {
      this.alternate.cells = this.resizeGrid(this.alternate.cells, nextColumns, nextRows);
      this.alternate.cursor.x = clamp(this.alternate.cursor.x, 0, nextColumns - 1);
      this.alternate.cursor.y = clamp(this.alternate.cursor.y, 0, nextRows - 1);
      this.alternate.savedCursor.x = clamp(this.alternate.savedCursor.x, 0, nextColumns - 1);
      this.alternate.savedCursor.y = clamp(this.alternate.savedCursor.y, 0, nextRows - 1);
    }
  }

  write(data: Uint8Array | string): void {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.byteCount += bytes.byteLength;
    this.consume(this.decoder.decode(bytes, { stream: true }));
  }

  flush(): void {
    const trailing = this.decoder.decode();
    if (trailing) this.consume(trailing);
  }

  reset(): void {
    this.cells = this.createGrid();
    this.cursor = { x: 0, y: 0 };
    this.savedCursor = { x: 0, y: 0 };
    this.style = defaultStyle();
    this.parserState = "normal";
    this.csiBuffer = "";
    this.oscBuffer = "";
    this.oscEscaped = false;
    this.wrapPending = false;
    this.cursorVisible = true;
    this.alternate = undefined;
    this.isAlternateScreen = false;
  }

  toStyledText(): StyledText {
    const chunks: TextChunk[] = [];
    for (let y = 0; y < this.rowCount; y += 1) {
      const row = this.cells[y]!;
      let run = "";
      let runCell = row[0]!;
      const flush = () => {
        if (!run) return;
        chunks.push({
          __isChunk: true,
          text: run,
          fg: cloneColor(runCell.fg),
          bg: cloneColor(runCell.bg),
          attributes: runCell.attributes,
        });
        run = "";
      };
      for (let x = 0; x < this.columnCount; x += 1) {
        const cell = row[x]!;
        const isCursor =
          this.cursorVisible && !this.alternate && x === this.cursor.x && y === this.cursor.y;
        const renderCell = isCursor
          ? {
              ...cell,
              fg: cloneColor(cell.bg),
              bg: cloneColor(cell.fg),
              attributes: cell.attributes | TextAttributes.INVERSE,
            }
          : cell;
        if (x > 0 && !styleEqual(runCell, renderCell)) flush();
        if (!run) runCell = renderCell;
        run += renderCell.char;
      }
      flush();
      if (y < this.rowCount - 1) chunks.push({ __isChunk: true, text: "\n" });
    }
    return new StyledText(chunks);
  }

  private createGrid(columns = this.columnCount, rows = this.rowCount): Cell[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: columns }, () => blankCell(this.style.fg, this.style.bg)),
    );
  }

  private resizeGrid(grid: Cell[][], columns: number, rows: number): Cell[][] {
    const next = Array.from({ length: rows }, (_value, rowIndex: number) =>
      Array.from({ length: columns }, (_columnValue, columnIndex: number) =>
        grid[rowIndex]?.[columnIndex]
          ? cloneCell(grid[rowIndex][columnIndex])
          : blankCell(this.style.fg, this.style.bg),
      ),
    );
    return next;
  }

  private consume(value: string): void {
    for (const char of value) this.consumeCharacter(char);
  }

  private consumeCharacter(char: string): void {
    if (this.parserState === "osc") {
      if (this.oscEscaped) {
        this.oscEscaped = false;
        if (char === "\\") {
          this.parserState = "normal";
          this.oscBuffer = "";
          return;
        }
      }
      if (char === "\x07") {
        this.parserState = "normal";
        this.oscBuffer = "";
      } else if (char === "\x1b") {
        this.oscEscaped = true;
      } else {
        this.oscBuffer += char;
      }
      return;
    }
    if (this.parserState === "csi") {
      if (char >= "@" && char <= "~") {
        this.handleCsi(char, this.csiBuffer);
        this.parserState = "normal";
        this.csiBuffer = "";
      } else {
        this.csiBuffer += char;
      }
      return;
    }
    if (this.parserState === "escape") {
      if (char === "[") {
        this.parserState = "csi";
        this.csiBuffer = "";
      } else if (char === "]") {
        this.parserState = "osc";
        this.oscBuffer = "";
      } else if (char === "7") {
        this.savedCursor = { ...this.cursor };
        this.parserState = "normal";
      } else if (char === "8") {
        this.cursor = { ...this.savedCursor };
        this.parserState = "normal";
      } else if (char === "c") {
        this.reset();
      } else {
        this.parserState = "normal";
      }
      return;
    }
    if (char === "\x1b") {
      this.parserState = "escape";
      this.ansiSequenceCount += 1;
      return;
    }
    if (char === "\r") {
      this.cursor.x = 0;
      this.wrapPending = false;
      return;
    }
    if (char === "\n") {
      this.lineFeed();
      return;
    }
    if (char === "\b") {
      this.cursor.x = Math.max(0, this.cursor.x - 1);
      this.wrapPending = false;
      return;
    }
    if (char === "\t") {
      this.cursor.x = Math.min(this.columnCount - 1, Math.ceil((this.cursor.x + 1) / 8) * 8);
      this.wrapPending = false;
      return;
    }
    if (char < " ") return;
    this.print(char);
  }

  private print(char: string): void {
    if (this.wrapPending) {
      this.cursor.x = 0;
      this.lineFeed();
      this.wrapPending = false;
    }
    const cell = this.cells[this.cursor.y]![this.cursor.x]!;
    cell.char = char;
    cell.fg = cloneColor(this.style.fg);
    cell.bg = cloneColor(this.style.bg);
    cell.attributes = this.style.attributes;
    if (this.cursor.x === this.columnCount - 1) {
      this.wrapPending = true;
    } else {
      this.cursor.x += 1;
    }
  }

  private lineFeed(): void {
    if (this.cursor.y === this.rowCount - 1) {
      this.cells.shift();
      this.cells.push(
        Array.from({ length: this.columnCount }, () => blankCell(this.style.fg, this.style.bg)),
      );
    } else {
      this.cursor.y += 1;
    }
  }

  private handleCsi(final: string, raw: string): void {
    const privateMode = raw.startsWith("?");
    const noPrivate =
      privateMode || raw.startsWith(">") || raw.startsWith("!") ? raw.slice(1) : raw;
    const params =
      noPrivate.length === 0 ? [] : noPrivate.split(";").map((part) => parseInteger(part, 0));
    const first = (fallback = 1): number => params[0] || fallback;
    const moveCursor = (x: number, y: number) => {
      this.cursor.x = clamp(x, 0, this.columnCount - 1);
      this.cursor.y = clamp(y, 0, this.rowCount - 1);
      this.wrapPending = false;
    };
    switch (final) {
      case "A":
        moveCursor(this.cursor.x, this.cursor.y - first());
        break;
      case "B":
      case "e":
        moveCursor(this.cursor.x, this.cursor.y + first());
        break;
      case "C":
      case "a":
        moveCursor(this.cursor.x + first(), this.cursor.y);
        break;
      case "D":
        moveCursor(this.cursor.x - first(), this.cursor.y);
        break;
      case "E":
        moveCursor(0, this.cursor.y + first());
        break;
      case "F":
        moveCursor(0, this.cursor.y - first());
        break;
      case "G":
      case "`":
        moveCursor(first() - 1, this.cursor.y);
        break;
      case "d":
        moveCursor(this.cursor.x, first() - 1);
        break;
      case "H":
      case "f":
        moveCursor((params[1] || 1) - 1, first() - 1);
        break;
      case "J":
        this.eraseDisplay(params[0] ?? 0);
        break;
      case "K":
        this.eraseLine(params[0] ?? 0);
        break;
      case "P":
        this.deleteCharacters(first());
        break;
      case "@":
        this.insertCharacters(first());
        break;
      case "m":
        this.applySgr(params.length === 0 ? [0] : params);
        break;
      case "s":
        this.savedCursor = { ...this.cursor };
        break;
      case "u":
        this.cursor = { ...this.savedCursor };
        break;
      case "h":
      case "l":
        if (privateMode) this.handlePrivateMode(final === "h", params);
        break;
      default:
        break;
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.cells = this.createGrid();
      this.cursor = { x: 0, y: 0 };
      return;
    }
    if (mode === 1) {
      for (let y = 0; y < this.cursor.y; y += 1) {
        this.cells[y] = this.cells[y]!.map(() => blankCell(this.style.fg, this.style.bg));
      }
      for (let x = 0; x <= this.cursor.x; x += 1) {
        this.cells[this.cursor.y]![x] = blankCell(this.style.fg, this.style.bg);
      }
      return;
    }
    for (let x = this.cursor.x; x < this.columnCount; x += 1) {
      this.cells[this.cursor.y]![x] = blankCell(this.style.fg, this.style.bg);
    }
    for (let y = this.cursor.y + 1; y < this.rowCount; y += 1) {
      this.cells[y] = this.cells[y]!.map(() => blankCell(this.style.fg, this.style.bg));
    }
  }

  private eraseLine(mode: number): void {
    const start = mode === 1 ? 0 : this.cursor.x;
    const end = mode === 0 ? this.columnCount : this.cursor.x + 1;
    for (let x = start; x < end; x += 1) {
      this.cells[this.cursor.y]![x] = blankCell(this.style.fg, this.style.bg);
    }
  }

  private deleteCharacters(count: number): void {
    const row = this.cells[this.cursor.y]!;
    for (let x = this.cursor.x; x < this.columnCount; x += 1) {
      row[x] =
        x + count < this.columnCount
          ? cloneCell(row[x + count]!)
          : blankCell(this.style.fg, this.style.bg);
    }
  }

  private insertCharacters(count: number): void {
    const row = this.cells[this.cursor.y]!;
    for (let x = this.columnCount - 1; x >= this.cursor.x; x -= 1) {
      row[x] =
        x - count >= this.cursor.x
          ? cloneCell(row[x - count]!)
          : blankCell(this.style.fg, this.style.bg);
    }
  }

  private applySgr(params: number[]): void {
    for (let index = 0; index < params.length; index += 1) {
      const code = params[index] ?? 0;
      if (code === 0) this.style = defaultStyle();
      else if (code === 1) this.style.attributes |= TextAttributes.BOLD;
      else if (code === 2) this.style.attributes |= TextAttributes.DIM;
      else if (code === 3) this.style.attributes |= TextAttributes.ITALIC;
      else if (code === 4) this.style.attributes |= TextAttributes.UNDERLINE;
      else if (code === 7) this.style.attributes |= TextAttributes.INVERSE;
      else if (code === 22) this.style.attributes &= ~(TextAttributes.BOLD | TextAttributes.DIM);
      else if (code === 23) this.style.attributes &= ~TextAttributes.ITALIC;
      else if (code === 24) this.style.attributes &= ~TextAttributes.UNDERLINE;
      else if (code === 27) this.style.attributes &= ~TextAttributes.INVERSE;
      else if (code >= 30 && code <= 37) this.style.fg = cloneColor(ansiPalette[code - 30]!);
      else if (code >= 40 && code <= 47) this.style.bg = cloneColor(ansiPalette[code - 40]!);
      else if (code >= 90 && code <= 97) this.style.fg = cloneColor(ansiPalette[code - 90 + 8]!);
      else if (code >= 100 && code <= 107) this.style.bg = cloneColor(ansiPalette[code - 100 + 8]!);
      else if (code === 39) this.style.fg = cloneColor(COLORS.text);
      else if (code === 49) this.style.bg = cloneColor(COLORS.background);
      else if (code === 38 || code === 48) {
        const isForeground = code === 38;
        const mode = params[index + 1];
        if (mode === 5 && params[index + 2] !== undefined) {
          const colour = ansi256(params[index + 2]!);
          if (isForeground) this.style.fg = colour;
          else this.style.bg = colour;
          index += 2;
        } else if (mode === 2 && params[index + 4] !== undefined) {
          const colour = RGBA.fromInts(params[index + 2]!, params[index + 3]!, params[index + 4]!);
          if (isForeground) this.style.fg = colour;
          else this.style.bg = colour;
          index += 4;
        }
      }
    }
  }

  private handlePrivateMode(enable: boolean, params: number[]): void {
    for (const mode of params) {
      if (mode === 25) this.cursorVisible = enable;
      if (mode === 1049 || mode === 47 || mode === 1047) {
        if (enable && !this.isAlternateScreen) this.enterAlternate();
        if (!enable && this.isAlternateScreen) this.leaveAlternate();
      }
    }
  }

  private enterAlternate(): void {
    this.alternate = {
      cells: cloneGrid(this.cells),
      cursor: { ...this.cursor },
      savedCursor: { ...this.savedCursor },
    };
    this.cells = this.createGrid();
    this.cursor = { x: 0, y: 0 };
    this.savedCursor = { x: 0, y: 0 };
    this.wrapPending = false;
    this.isAlternateScreen = true;
  }

  private leaveAlternate(): void {
    if (!this.alternate) return;
    this.cells = this.alternate.cells;
    this.cursor = this.alternate.cursor;
    this.savedCursor = this.alternate.savedCursor;
    this.alternate = undefined;
    this.wrapPending = false;
    this.isAlternateScreen = false;
  }
}

const parseArgv = (): string[] => {
  const value = process.env.AO_PTY_POC_ARGV;
  if (!value) return [process.env.SHELL || "bash"];
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((part) => typeof part === "string")
    ) {
      return parsed;
    }
  } catch {
    // The status panel reports the invalid value after the renderer starts.
  }
  return [process.env.SHELL || "bash"];
};

const keyBytes = (key: { sequence: string; raw: string }): string => key.sequence || key.raw;

const createStyledStatus = (status: string, colour: RGBA): StyledText =>
  new StyledText([{ __isChunk: true, text: status, fg: colour, attributes: TextAttributes.NONE }]);

const main = async (): Promise<void> => {
  const renderer = await createCliRenderer({
    targetFps: 30,
    maxFps: 60,
    gatherStats: true,
    useMouse: false,
    autoFocus: false,
    exitOnCtrlC: false,
    clearOnShutdown: true,
  });

  let status = "starting child PTY…";
  let childExit: number | undefined;
  let closed = false;
  const argv = parseArgv();
  const columns = Math.max(MIN_COLUMNS, renderer.width - 34);
  const rows = Math.max(MIN_ROWS, renderer.height - 7);
  const screen = new PseudoTerminalScreen(columns, rows);

  const header = new TextRenderable(renderer, {
    id: "ao-pty-poc-header",
    position: "absolute",
    left: 1,
    top: 0,
    width: renderer.width - 2,
    height: 2,
    content: "AO OBSERVATORY  /  DISPOSABLE PTY SURFACE POC",
    fg: COLORS.cyan,
    bg: COLORS.background,
  });
  const help = new TextRenderable(renderer, {
    id: "ao-pty-poc-help",
    position: "absolute",
    left: 1,
    top: 2,
    width: renderer.width - 2,
    height: 1,
    content:
      "native child PTY  ·  Ctrl-Q quit  ·  all other keys go to the child  ·  resize follows the window",
    fg: COLORS.muted,
    bg: COLORS.background,
  });
  const context = new BoxRenderable(renderer, {
    id: "ao-pty-poc-context",
    position: "absolute",
    left: 1,
    top: 4,
    width: 29,
    height: renderer.height - 6,
    border: true,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panel,
    title: " OBSERVATORY ",
    titleColor: COLORS.cyan,
  });
  const contextText = new TextRenderable(renderer, {
    id: "ao-pty-poc-context-text",
    position: "absolute",
    left: 2,
    top: 2,
    width: 25,
    height: renderer.height - 10,
    content:
      "GOAL\n  building observatory\n\nSESSION\n  native shell / CLI\n\nHOST\n  AO-owned PTY\n\nCAPABILITIES\n  ✓ real TTY\n  ✓ ANSI / cursor\n  ✓ alternate screen\n  ✓ input / resize\n\nVERDICT\n  pending dogfood",
    fg: COLORS.text,
    bg: COLORS.panel,
  });
  context.add(contextText);

  const terminalPanel = new BoxRenderable(renderer, {
    id: "ao-pty-poc-terminal",
    position: "absolute",
    left: 31,
    top: 4,
    width: renderer.width - 32,
    height: renderer.height - 6,
    border: true,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.background,
    title: " CHILD PTY ",
    titleColor: COLORS.green,
  });
  const terminalText = new TextRenderable(renderer, {
    id: "ao-pty-poc-terminal-text",
    position: "absolute",
    left: 33,
    top: 5,
    width: columns,
    height: rows,
    content: screen.toStyledText(),
    fg: COLORS.text,
    bg: COLORS.background,
  });
  terminalPanel.add(terminalText);

  const footer = new TextRenderable(renderer, {
    id: "ao-pty-poc-footer",
    position: "absolute",
    left: 1,
    top: renderer.height - 1,
    width: renderer.width - 2,
    height: 1,
    content: createStyledStatus(status, COLORS.yellow),
    bg: COLORS.background,
  });

  renderer.root.add(header);
  renderer.root.add(help);
  renderer.root.add(context);
  renderer.root.add(terminalPanel);
  renderer.root.add(footer);

  const updateStatus = (next: string, colour = COLORS.yellow): void => {
    if (closed) return;
    status = next;
    footer.content = createStyledStatus(status, colour);
    renderer.requestRender();
  };

  const updateLayout = (width: number, height: number): void => {
    const nextColumns = Math.max(MIN_COLUMNS, width - 34);
    const nextRows = Math.max(MIN_ROWS, height - 7);
    screen.resize(nextColumns, nextRows);
    renderer.root.width = width;
    header.width = width - 2;
    help.width = width - 2;
    context.height = height - 6;
    contextText.height = height - 10;
    terminalPanel.width = width - 32;
    terminalPanel.height = height - 6;
    terminalText.width = nextColumns;
    terminalText.height = nextRows;
    terminalText.content = screen.toStyledText();
    footer.top = height - 1;
    footer.width = width - 2;
  };

  renderer.on("resize", (width: number, height: number) => {
    updateLayout(width, height);
    pty?.terminal.resize(screen.columns, screen.rows);
    updateStatus(`resized PTY to ${screen.columns}×${screen.rows}`, COLORS.cyan);
  });

  let pty: { terminal: Bun.Terminal; proc: Bun.Subprocess } | undefined;
  try {
    const terminal = new Bun.Terminal({
      cols: screen.columns,
      rows: screen.rows,
      name: "xterm-256color",
      data: (_terminal, data) => {
        if (closed) return;
        screen.write(data);
        terminalText.content = screen.toStyledText();
        renderer.requestRender();
      },
      exit: () => {
        if (childExit === undefined) updateStatus("PTY stream closed", COLORS.orange);
      },
    });
    const proc = Bun.spawn(argv, {
      terminal,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
    pty = { terminal, proc };
    updateStatus(`running ${argv.join(" ")}`, COLORS.green);
    void proc.exited.then((exitCode) => {
      if (closed) return;
      childExit = exitCode;
      screen.flush();
      terminalText.content = screen.toStyledText();
      updateStatus(
        `child exited ${exitCode} · Ctrl-Q to leave`,
        exitCode === 0 ? COLORS.muted : COLORS.red,
      );
    });
  } catch (error) {
    updateStatus(`failed to start PTY: ${String(error)}`, COLORS.red);
  }

  const quit = (): void => {
    if (closed) return;
    closed = true;
    if (pty && !pty.terminal.closed) pty.terminal.close();
    renderer.destroy();
  };

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name.toLowerCase() === "q") {
      key.preventDefault();
      quit();
      return;
    }
    if (!pty || pty.terminal.closed) return;
    pty.terminal.write(keyBytes(key));
  });
  renderer.keyInput.on("paste", (event) => {
    if (!pty || pty.terminal.closed) return;
    pty.terminal.write(event.bytes);
  });

  renderer.on("capabilities", (capabilities) => {
    const terminalName = capabilities.terminal.name || "unknown terminal";
    updateStatus(`running ${argv.join(" ")} · host ${terminalName}`, COLORS.green);
  });
  renderer.start();

  process.once("SIGTERM", quit);
  process.once("SIGINT", () => {
    if (pty && !pty.terminal.closed) pty.terminal.write("\x03");
    else quit();
  });
};

if (import.meta.main) await main();
