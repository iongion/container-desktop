// One pi component, painted. Frames arrive as whole renders of ANSI lines, so the surface clears and
// rewrites rather than appending: this is a view of a component's current state, not a log.
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { type ITheme, Terminal as XTermTerminal } from "@xterm/xterm";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { keyEventToTerminalData } from "@/web-app/components/ai/surfaceKeys";
import { readAppPiThemePalette } from "@/web-app/themes/appPiTheme";
import { getAppThemeEpoch, subscribeAppThemeEpoch } from "@/web-app/themes/appThemeEpoch";

import "@xterm/xterm/css/xterm.css";

import "./AnsiSurface.css";

export interface AnsiSurfaceProps {
  surfaceId: string;
  lines: string[];
  focus?: boolean;
  ariaLabel?: string;
  onInput?: (surfaceId: string, data: string) => void;
  onResize?: (surfaceId: string, columns: number) => void;
}

const MIN_COLUMNS = 20;
const FONT_SIZE = 12;

let cachedTheme: { epoch: number; theme: ITheme } | undefined;

// xterm renders to its own surface and cannot read CSS var()s, so the palette is resolved off the DOM. The
// ANSI colours a pi component emits are truecolor escapes from the theme the container derived from these
// same tokens, so only the canvas background and the default foreground are needed here. The theme epoch is
// the cache key because it is exactly what invalidates the answer — every surface on screen otherwise
// re-reads ten computed styles on the same repaint.
function resolveSurfaceTheme(epoch: number): ITheme {
  if (cachedTheme?.epoch === epoch) return cachedTheme.theme;
  const palette = readAppPiThemePalette();
  const theme: ITheme = {
    background: palette.surface ?? "#1c2127",
    foreground: palette.text ?? "#e5e8eb",
    cursor: palette.accent ?? "#e5e8eb",
    cursorAccent: palette.surface ?? "#1c2127",
    selectionBackground: palette.border ?? "#404854",
  };
  cachedTheme = { epoch, theme };
  return theme;
}

function resolveSurfaceFont(): string {
  return (
    getComputedStyle(document.body).getPropertyValue("--monospace-font-embedded").trim() ||
    `"JetBrains Mono", monospace`
  );
}

export const AnsiSurface: React.FC<AnsiSurfaceProps> = ({ surfaceId, lines, focus, ariaLabel, onInput, onResize }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const term = useRef<XTermTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const columns = useRef(0);
  const rows = useRef(Math.max(1, lines.length));
  const callbacks = useRef({ onInput, onResize });
  const themeEpoch = useSyncExternalStore(subscribeAppThemeEpoch, getAppThemeEpoch, getAppThemeEpoch);
  const surfaceTheme = useMemo(() => resolveSurfaceTheme(themeEpoch), [themeEpoch]);
  const latestTheme = useRef(surfaceTheme);

  callbacks.current = { onInput, onResize };
  latestTheme.current = surfaceTheme;
  rows.current = Math.max(1, lines.length);

  useEffect(() => {
    if (!wrapRef.current || term.current) return;
    const terminal = new XTermTerminal({
      theme: latestTheme.current,
      fontFamily: resolveSurfaceFont(),
      fontSize: FONT_SIZE,
      convertEol: true,
      // A frame is the whole render; there is nothing earlier to scroll back to.
      scrollback: 0,
      disableStdin: true,
      cursorStyle: "bar",
      logLevel: "error",
      allowProposedApi: true,
      rows: rows.current,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new Unicode11Addon());
    terminal.open(wrapRef.current);
    terminal.unicode.activeVersion = "11";
    // The component draws its own cursor into the lines when it wants one; xterm's would sit at the end of
    // the last line and blink where nothing is happening.
    terminal.write("\x1b[?25l");
    term.current = terminal;
    fit.current = fitAddon;

    // The container renders a component at the width reported here and sends back lines already wrapped to
    // it, so xterm has to be the same width or every line wraps twice.
    const measure = () => {
      const proposed = fitAddon.proposeDimensions();
      const width = Math.max(MIN_COLUMNS, proposed?.cols ?? MIN_COLUMNS);
      if (width === columns.current) return;
      columns.current = width;
      terminal.resize(width, rows.current);
      callbacks.current.onResize?.(surfaceId, width);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(wrapRef.current);

    return () => {
      observer.disconnect();
      terminal.dispose();
      term.current = null;
      fit.current = null;
      columns.current = 0;
    };
  }, [surfaceId]);

  // The app repainted its tokens, so the canvas behind the plugin's own colours has to follow.
  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    terminal.options.theme = surfaceTheme;
    terminal.refresh(0, terminal.rows - 1);
  }, [surfaceTheme]);

  // Whole frames: clear, then write. `reset` also drops the scroll region and any mode a previous frame's
  // escapes left behind, which a plugin component is free to set.
  useEffect(() => {
    const terminal = term.current;
    if (!terminal) return;
    terminal.resize(columns.current || terminal.cols, Math.max(1, lines.length));
    terminal.reset();
    terminal.write("\x1b[?25l");
    terminal.write(lines.join("\r\n"));
  }, [lines]);

  return (
    <div
      ref={wrapRef}
      className={`AnsiSurface${focus ? " AnsiSurface--focused" : ""}`}
      // An embedded terminal component is an application region whether or not it currently holds the
      // keyboard; only a focused one takes keys, because only one surface can own them at a time.
      role="application"
      aria-label={ariaLabel ?? "extension component"}
      tabIndex={focus ? 0 : -1}
      onKeyDown={(event) => {
        if (!focus) return;
        const data = keyEventToTerminalData(event);
        if (data === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        callbacks.current.onInput?.(surfaceId, data);
      }}
    />
  );
};
