import { type ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTermTerminal } from "@xterm/xterm";

import { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

import "./Terminal.css";

export type TerminalWriteMode = "append" | "replace" | "delta";

export interface TerminalHandle {
  clear: () => void;
  fit: () => void;
  getTerminal: () => XTermTerminal | null;
  write: (data: string | Uint8Array) => void;
}

export interface TerminalProps {
  value?: string | Uint8Array;
  writeMode?: TerminalWriteMode;
  onReady?: (handle: TerminalHandle) => void;
}

function toTerminalData(value: string | Uint8Array): string {
  if (typeof value === "string") {
    return value;
  }
  return new TextDecoder().decode(value);
}

export const Terminal: React.FC<TerminalProps> = ({ value, writeMode = "append", onReady }: TerminalProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const term = useRef<XTermTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const lastValue = useRef("");
  const readyCallback = useRef(onReady);

  readyCallback.current = onReady;

  const handleResize = (entries: ResizeEntry[]) => {
    const [entry] = entries;
    if (entry && fit.current) {
      fit.current.fit();
    }
  };

  useEffect(() => {
    if (!wrapRef.current || term.current) {
      return;
    }
    viewRef.current = wrapRef.current.querySelector<HTMLDivElement>(".TerminalViewContent") ?? null;
    const fitAddon = new FitAddon();
    const webglAddon = new WebglAddon();
    const unicode11Addon = new Unicode11Addon();
    const terminal = new XTermTerminal({
      convertEol: true,
      drawBoldTextInBrightColors: true,
      rescaleOverlappingGlyphs: true,
      rightClickSelectsWord: true,
      fontSize: 12,
      fontFamily: `Consolas, "SF Mono", "DejaVu Sans Mono", "Droid Sans Mono", "Ubuntu Mono", "Roboto Mono", "Fira Code", monospace, "Powerline Extra Symbols"`,
      disableStdin: true,
      scrollback: 16 * 1024,
      logLevel: "error",
      allowProposedApi: true,
      fontWeight: "normal",
    });
    if (viewRef.current) {
      terminal.open(viewRef.current);
    }
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new SearchAddon());
    try {
      terminal.loadAddon(webglAddon);
    } catch (error: any) {
      console.error("Unable to activate web gl", error);
    }
    fitAddon.fit();
    terminal.focus();
    terminal.clear();
    terminal.unicode.activeVersion = "11";
    terminal.write("\x1b[?25l"); // disable cursor
    terminal.writeln("If they exist, logs will be displayed shortly");
    term.current = terminal;
    fit.current = fitAddon;
    readyCallback.current?.({
      clear: () => {
        terminal.clear();
        lastValue.current = "";
      },
      fit: () => fitAddon.fit(),
      getTerminal: () => terminal,
      write: (data) => terminal.write(data as any),
    });

    return () => {
      terminal.dispose();
      term.current = null;
      fit.current = null;
      lastValue.current = "";
    };
  }, []);

  useEffect(() => {
    if (!term.current || typeof value === "undefined" || value === null) {
      return;
    }
    const next = toTerminalData(value);
    if (!next) {
      return;
    }
    if (writeMode === "replace") {
      term.current.clear();
      term.current.write(next as any);
      lastValue.current = next;
      return;
    }
    if (writeMode === "delta") {
      const previous = lastValue.current;
      if (next.startsWith(previous)) {
        const delta = next.slice(previous.length);
        if (delta) {
          term.current.write(delta as any);
        }
      } else {
        term.current.clear();
        term.current.write(next as any);
      }
      lastValue.current = next;
      return;
    }
    term.current.write(next as any);
  }, [value, writeMode]);

  return (
    <div className="TerminalView">
      <div className="TerminalViewContentWrap" ref={wrapRef}>
        <ResizeSensor onResize={handleResize}>
          <div className="TerminalViewContent"></div>
        </ResizeSensor>
      </div>
    </div>
  );
};
