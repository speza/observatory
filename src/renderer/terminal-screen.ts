import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core";

export const TERMINAL_DEFAULT_COLUMNS = 80;
export const TERMINAL_DEFAULT_ROWS = 24;
export const TERMINAL_MIN_COLUMNS = 24;
export const TERMINAL_MIN_ROWS = 8;

export const TERMINAL_COLORS = {
  background: RGBA.fromHex("#08131f"),
  text: RGBA.fromHex("#dcecf2"),
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

type Style = {
  fg: RGBA;
  bg: RGBA;
  attributes: number;
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

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

const defaultStyle = (): Style => ({
  fg: cloneColor(TERMINAL_COLORS.text),
  bg: cloneColor(TERMINAL_COLORS.background),
  attributes: TextAttributes.NONE,
});

const styleEqual = (left: Cell, right: Cell): boolean =>
  left.fg.equals(right.fg) && left.bg.equals(right.bg) && left.attributes === right.attributes;

const parseInteger = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

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

const positive = (value: number): number => Math.max(1, value);

/** A bounded VT/xterm-ish screen model for the embedded terminal lens. */
export class TerminalScreen {
  private columnCount: number;
  private rowCount: number;
  private cells: Cell[][];
  private alternate: SavedScreen | undefined;
  private cursor: Cursor = { x: 0, y: 0 };
  private savedCursor: Cursor = { x: 0, y: 0 };
  private style: Style = defaultStyle();
  private parserState: "normal" | "escape" | "csi" | "osc" = "normal";
  private csiBuffer = "";
  private oscEscaped = false;
  private wrapPending = false;
  private cursorVisible = true;
  private decoder = new TextDecoder();
  private byteCount = 0;
  private ansiSequenceCount = 0;
  private isAlternateScreen = false;

  constructor(columns = TERMINAL_DEFAULT_COLUMNS, rows = TERMINAL_DEFAULT_ROWS) {
    this.columnCount = Math.max(TERMINAL_MIN_COLUMNS, columns);
    this.rowCount = Math.max(TERMINAL_MIN_ROWS, rows);
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
    const nextColumns = Math.max(TERMINAL_MIN_COLUMNS, Math.floor(columns));
    const nextRows = Math.max(TERMINAL_MIN_ROWS, Math.floor(rows));
    if (nextColumns === this.columnCount && nextRows === this.rowCount) return;
    const next = this.resizeGrid(this.cells, nextColumns, nextRows);
    this.columnCount = nextColumns;
    this.rowCount = nextRows;
    this.cells = next;
    this.cursor.x = clamp(this.cursor.x, 0, nextColumns - 1);
    this.cursor.y = clamp(this.cursor.y, 0, nextRows - 1);
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
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(data);
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
        const isCursor = this.cursorVisible && x === this.cursor.x && y === this.cursor.y;
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
    return Array.from({ length: rows }, (_value, rowIndex) =>
      Array.from({ length: columns }, (_columnValue, columnIndex) =>
        cloneCell(grid[rowIndex]?.[columnIndex] ?? blankCell(this.style.fg, this.style.bg)),
      ),
    );
  }

  private consume(value: string): void {
    for (const character of value) this.consumeCharacter(character);
  }

  private consumeCharacter(character: string): void {
    if (this.parserState === "osc") {
      if (this.oscEscaped) {
        this.oscEscaped = false;
        if (character === "\\") this.parserState = "normal";
        return;
      }
      if (character === "\x07") this.parserState = "normal";
      else if (character === "\x1b") this.oscEscaped = true;
      return;
    }
    if (this.parserState === "csi") {
      if (character >= "@" && character <= "~") {
        this.handleCsi(character, this.csiBuffer);
        this.parserState = "normal";
        this.csiBuffer = "";
      } else {
        this.csiBuffer += character;
      }
      return;
    }
    if (this.parserState === "escape") {
      if (character === "[") {
        this.parserState = "csi";
        this.csiBuffer = "";
      } else if (character === "]") {
        this.parserState = "osc";
      } else if (character === "7") {
        this.savedCursor = { ...this.cursor };
        this.parserState = "normal";
      } else if (character === "8") {
        this.cursor = { ...this.savedCursor };
        this.parserState = "normal";
      } else if (character === "c") {
        this.reset();
      } else {
        this.parserState = "normal";
      }
      return;
    }
    if (character === "\x1b") {
      this.parserState = "escape";
      this.ansiSequenceCount += 1;
      return;
    }
    if (character === "\r") {
      this.cursor.x = 0;
      this.wrapPending = false;
      return;
    }
    if (character === "\n") {
      this.lineFeed();
      return;
    }
    if (character === "\b") {
      this.cursor.x = Math.max(0, this.cursor.x - 1);
      this.wrapPending = false;
      return;
    }
    if (character === "\t") {
      this.cursor.x = Math.min(this.columnCount - 1, Math.ceil((this.cursor.x + 1) / 8) * 8);
      this.wrapPending = false;
      return;
    }
    if (character < " ") return;
    this.print(character);
  }

  private print(character: string): void {
    if (this.wrapPending) {
      this.cursor.x = 0;
      this.lineFeed();
      this.wrapPending = false;
    }
    const cell = this.cells[this.cursor.y]![this.cursor.x]!;
    cell.char = character;
    cell.fg = cloneColor(this.style.fg);
    cell.bg = cloneColor(this.style.bg);
    cell.attributes = this.style.attributes;
    if (this.cursor.x === this.columnCount - 1) this.wrapPending = true;
    else this.cursor.x += 1;
  }

  private lineFeed(): void {
    if (this.cursor.y === this.rowCount - 1) {
      this.cells.shift();
      this.cells.push(
        Array.from({ length: this.columnCount }, () => blankCell(this.style.fg, this.style.bg)),
      );
    } else this.cursor.y += 1;
  }

  private handleCsi(final: string, raw: string): void {
    const privateMode = raw.startsWith("?");
    const parameters =
      privateMode || raw.startsWith(">") || raw.startsWith("!") ? raw.slice(1) : raw;
    const params =
      parameters.length === 0 ? [] : parameters.split(";").map((part) => parseInteger(part, 0));
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
      this.wrapPending = false;
      return;
    }
    if (mode === 1) {
      for (let y = 0; y < this.cursor.y; y += 1)
        this.cells[y] = this.cells[y]!.map(() => blankCell(this.style.fg, this.style.bg));
      for (let x = 0; x <= this.cursor.x; x += 1)
        this.cells[this.cursor.y]![x] = blankCell(this.style.fg, this.style.bg);
      return;
    }
    for (let x = this.cursor.x; x < this.columnCount; x += 1)
      this.cells[this.cursor.y]![x] = blankCell(this.style.fg, this.style.bg);
    for (let y = this.cursor.y + 1; y < this.rowCount; y += 1)
      this.cells[y] = this.cells[y]!.map(() => blankCell(this.style.fg, this.style.bg));
  }

  private eraseLine(mode: number): void {
    const start = mode === 1 ? 0 : this.cursor.x;
    const end = mode === 0 ? this.columnCount : this.cursor.x + 1;
    for (let x = start; x < end; x += 1)
      this.cells[this.cursor.y]![x] = blankCell(this.style.fg, this.style.bg);
  }

  private deleteCharacters(count: number): void {
    const row = this.cells[this.cursor.y]!;
    for (let x = this.cursor.x; x < this.columnCount; x += 1)
      row[x] =
        x + count < this.columnCount
          ? cloneCell(row[x + count]!)
          : blankCell(this.style.fg, this.style.bg);
  }

  private insertCharacters(count: number): void {
    const row = this.cells[this.cursor.y]!;
    for (let x = this.columnCount - 1; x >= this.cursor.x; x -= 1)
      row[x] =
        x - count >= this.cursor.x
          ? cloneCell(row[x - count]!)
          : blankCell(this.style.fg, this.style.bg);
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
      else if (code === 39) this.style.fg = cloneColor(TERMINAL_COLORS.text);
      else if (code === 49) this.style.bg = cloneColor(TERMINAL_COLORS.background);
      else if (code === 38 || code === 48) {
        const foreground = code === 38;
        const mode = params[index + 1];
        if (mode === 5 && params[index + 2] !== undefined) {
          const colour = ansi256(params[index + 2]!);
          if (foreground) this.style.fg = colour;
          else this.style.bg = colour;
          index += 2;
        } else if (mode === 2 && params[index + 4] !== undefined) {
          const colour = RGBA.fromInts(params[index + 2]!, params[index + 3]!, params[index + 4]!);
          if (foreground) this.style.fg = colour;
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

export const terminalDimensionsFor = (width: number, height: number) => ({
  columns: Math.max(TERMINAL_MIN_COLUMNS, width),
  rows: Math.max(TERMINAL_MIN_ROWS, height),
});

export const ensureTerminalDimensions = (columns: number, rows: number) => ({
  columns: Math.max(TERMINAL_MIN_COLUMNS, positive(Math.floor(columns))),
  rows: Math.max(TERMINAL_MIN_ROWS, positive(Math.floor(rows))),
});
