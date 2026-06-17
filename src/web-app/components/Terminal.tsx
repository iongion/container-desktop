import { type ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITheme, Terminal as XTermTerminal } from "@xterm/xterm";

import { useEffect, useRef } from "react";

import { AppTheme } from "@/web-app/App.types";
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

// xterm renders to a canvas and can't read CSS var()s, so the palette is provided as concrete
// colors and switched with the app theme: a light surface in light mode, a neutral dark surface
// in dark mode. ANSI colors are tuned for legibility against each background.
const DARK_TERMINAL_THEME: ITheme = {
  background: "#1c2127",
  foreground: "#e5e8eb",
  cursor: "#e5e8eb",
  cursorAccent: "#1c2127",
  selectionBackground: "#3f4754",
  black: "#1c2127",
  red: "#ff7373",
  green: "#72ca9b",
  yellow: "#fbd065",
  blue: "#8abbff",
  magenta: "#d69fd6",
  cyan: "#68c1ee",
  white: "#c1c8d1",
  brightBlack: "#5f6b7c",
  brightRed: "#ffa3a3",
  brightGreen: "#a3e8c6",
  brightYellow: "#ffe39e",
  brightBlue: "#b3d4ff",
  brightMagenta: "#e8c4e8",
  brightCyan: "#a0dbf5",
  brightWhite: "#ffffff",
};
const LIGHT_TERMINAL_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#1c2127",
  cursor: "#1c2127",
  cursorAccent: "#ffffff",
  selectionBackground: "#c5cbd3",
  black: "#1c2127",
  red: "#cd4246",
  green: "#1c6e42",
  yellow: "#946638",
  blue: "#215db0",
  magenta: "#9d3f9d",
  cyan: "#147eb3",
  white: "#5f6b7c",
  brightBlack: "#738091",
  brightRed: "#ac2f33",
  brightGreen: "#165a36",
  brightYellow: "#5c4108",
  brightBlue: "#184a90",
  brightMagenta: "#7c327c",
  brightCyan: "#0f6894",
  brightWhite: "#1c2127",
};
// Background/foreground follow the live --app-surface / --app-text tokens so the terminal matches the
// theme AND the per-engine dark tint (docker navy / podman purple); the ANSI palette + selection come
// from the light/dark base. xterm can't read CSS var()s, so we resolve them off the DOM here.
function resolveTerminalTheme(appTheme?: string): ITheme {
  const isLight = appTheme === AppTheme.LIGHT;
  const base = isLight ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME;
  const cs = getComputedStyle(document.body);
  const surface = cs.getPropertyValue("--app-surface").trim();
  const text = cs.getPropertyValue("--app-text").trim();
  return {
    ...base,
    ...(surface ? { background: surface, cursorAccent: surface } : {}),
    ...(text ? { foreground: text, cursor: text } : {}),
  };
}

export const Terminal: React.FC<TerminalProps> = ({ value, writeMode = "append", onReady, overlay }: TerminalProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const term = useRef<XTermTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const webgl = useRef<WebglAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const lastValue = useRef("");
  const readyCallback = useRef(onReady);

  readyCallback.current = onReady;

  const font = useAppStore((state) => state.userSettings.font);
  const appTheme = useAppStore((state) => state.userSettings.theme);

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
      theme: resolveTerminalTheme(useAppStore.getState().userSettings.theme),
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
    // WebLinksAddon intentionally NOT loaded: terminal output (e.g. container logs) is untrusted, so
    // auto-linkifying URLs would turn arbitrary log text into clickable links — a phishing/exfil vector.
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
      webgl.current = webglAddon;
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
      webgl.current = null;
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

  // Live-apply theme (light/dark) to the existing terminal without remounting.
  useEffect(() => {
    const terminal = term.current;
    if (!terminal) {
      return;
    }
    terminal.options.theme = resolveTerminalTheme(appTheme);
    webgl.current?.clearTextureAtlas?.();
    terminal.refresh(0, terminal.rows - 1);
  }, [appTheme]);

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
