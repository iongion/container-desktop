import type { Terminal } from "@earendil-works/pi-tui";

export interface VirtualTerminal {
  terminal: Terminal;
  setSize(columns: number, rows: number): void;
  feedInput(data: string): void;
  drainWrites(): string;
}

export interface VirtualTerminalOptions {
  columns: number;
  rows: number;
  onTitle?: (title: string) => void;
  maxWriteBufferChars?: number;
}

// Enough for a few screens of direct writes; anything past that is a component talking to a terminal
// that has no screen, and the oldest chunks are the ones nobody will read.
const DEFAULT_MAX_WRITE_BUFFER_CHARS = 64 * 1024;

// pi's `Terminal` over a size the GUI owns. Components are rendered by calling `render(width)` and
// shipping the lines, so nothing here has to emulate a screen: writes are captured for diagnosis,
// input is fed from the renderer's keystrokes, and the cursor/clear members have nothing to move.
export function createVirtualTerminal(options: VirtualTerminalOptions): VirtualTerminal {
  const maxWriteBufferChars = options.maxWriteBufferChars ?? DEFAULT_MAX_WRITE_BUFFER_CHARS;
  let columns = clampSize(options.columns);
  let rows = clampSize(options.rows);
  let inputHandler: ((data: string) => void) | undefined;
  let resizeHandler: (() => void) | undefined;
  let writes: string[] = [];
  let writtenChars = 0;

  const terminal: Terminal = {
    start(onInput, onResize) {
      inputHandler = onInput;
      resizeHandler = onResize;
    },

    stop() {
      inputHandler = undefined;
      resizeHandler = undefined;
    },

    // Nothing buffers input on this side: the renderer sends one keystroke per command.
    async drainInput() {},

    write(data: string) {
      writes.push(data);
      writtenChars += data.length;
      while (writtenChars > maxWriteBufferChars && writes.length > 1) {
        writtenChars -= writes.shift()?.length ?? 0;
      }
    },

    get columns() {
      return columns;
    },

    get rows() {
      return rows;
    },

    // The GUI never negotiates the kitty protocol, so key release events never arrive and pi must not
    // encode for them.
    get kittyProtocolActive() {
      return false;
    },

    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},

    setTitle(title: string) {
      options.onTitle?.(title);
    },

    setProgress() {},
  };

  return {
    terminal,

    setSize(nextColumns: number, nextRows: number) {
      const width = clampSize(nextColumns);
      const height = clampSize(nextRows);
      if (width === columns && height === rows) return;
      columns = width;
      rows = height;
      resizeHandler?.();
    },

    feedInput(data: string) {
      inputHandler?.(data);
    },

    drainWrites() {
      const buffered = writes.join("");
      writes = [];
      writtenChars = 0;
      return buffered;
    },
  };
}

function clampSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
