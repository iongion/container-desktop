import { type ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTermTerminal } from "@xterm/xterm";

import { useEffect, useRef } from "react";

import { useAppStore } from "@/web-app/stores/appStore";

import { registerFindTarget } from "./Find/findTargets";
import { createWriteBuffer } from "./terminalWriteBuffer";

import "@xterm/xterm/css/xterm.css";

import "./Terminal.css";

export type TerminalWriteMode = "append" | "replace" | "delta";

export interface TerminalHandle {
  clear: () => void;
  fit: () => void;
  getTerminal: () => XTermTerminal | null;
  getSearchAddon: () => SearchAddon | null;
  write: (data: string | Uint8Array) => void;
}

export interface TerminalProps {
  value?: string | Uint8Array;
  writeMode?: TerminalWriteMode;
  onReady?: (handle: TerminalHandle) => void;
  overlay?: React.ReactNode;
}

function toTerminalData(value: string | Uint8Array): string {
  if (typeof value === "string") {
    return value;
  }
  return new TextDecoder().decode(value);
}

// Resolve xterm font options from the user's settings, always keeping the bundled chain as a
// fallback. xterm can't resolve CSS var(), so we read the resolved --monospace-font-embedded.
function resolveTerminalFont(font?: { family?: string; size?: number; weight?: number }) {
  const embedded =
    getComputedStyle(document.body).getPropertyValue("--monospace-font-embedded").trim() ||
    `"JetBrains Mono", monospace`;
  return {
    fontFamily: font?.family ? `"${font.family}", ${embedded}` : embedded,
    fontSize: font?.size || 12,
    fontWeight: (font?.weight || "normal") as any,
  };
}

export const Terminal: React.FC<TerminalProps> = ({ value, writeMode = "append", onReady, overlay }: TerminalProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const term = useRef<XTermTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const lastValue = useRef("");
  const readyCallback = useRef(onReady);

  readyCallback.current = onReady;

  const font = useAppStore((state) => state.userSettings.font);

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
    const initialFont = resolveTerminalFont(useAppStore.getState().userSettings.font);
    const terminal = new XTermTerminal({
      convertEol: true,
      drawBoldTextInBrightColors: true,
      rescaleOverlappingGlyphs: true,
      rightClickSelectsWord: true,
      fontSize: initialFont.fontSize,
      fontFamily: initialFont.fontFamily,
      disableStdin: true,
      scrollback: 16 * 1024,
      logLevel: "error",
      allowProposedApi: true,
      fontWeight: initialFont.fontWeight,
    });
    if (viewRef.current) {
      terminal.open(viewRef.current);
    }
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(new WebLinksAddon());
    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
    search.current = searchAddon;
    // Let the app's global find hotkey (mod/ctrl+f) bubble out of the terminal instead of
    // being swallowed by xterm, so Ctrl+F opens the find widget while the terminal is focused.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && (event.ctrlKey || event.metaKey) && (event.key === "f" || event.key === "F")) {
        return false;
      }
      return true;
    });
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
    const writeBuffer = createWriteBuffer((chunk) => terminal.write(chunk));
    readyCallback.current?.({
      clear: () => {
        writeBuffer.reset();
        terminal.clear();
        lastValue.current = "";
      },
      fit: () => fitAddon.fit(),
      getTerminal: () => terminal,
      getSearchAddon: () => search.current,
      write: (data) => writeBuffer.push(toTerminalData(data)),
    });

    const unregisterFindTarget = viewRef.current
      ? registerFindTarget({ type: "terminal", el: viewRef.current, getSearchAddon: () => search.current })
      : undefined;

    return () => {
      unregisterFindTarget?.();
      writeBuffer.dispose();
      terminal.dispose();
      term.current = null;
      fit.current = null;
      search.current = null;
      lastValue.current = "";
    };
  }, []);

  // Live-apply font changes to the existing terminal (no remount, scrollback preserved).
  useEffect(() => {
    const terminal = term.current;
    if (!terminal) {
      return;
    }
    const resolved = resolveTerminalFont(font);
    terminal.options.fontFamily = resolved.fontFamily;
    terminal.options.fontSize = resolved.fontSize;
    terminal.options.fontWeight = resolved.fontWeight;
    fit.current?.fit();
  }, [font]);

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
      {overlay}
    </div>
  );
};
