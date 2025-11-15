import { type ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTermTerminal } from "@xterm/xterm";

import { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

import "./Terminal.css";

export interface TerminalProps {
  value?: string | Uint8Array;
}

export const Terminal: React.FC<TerminalProps> = ({ value }: TerminalProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const term = useRef<XTermTerminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const handleResize = (entries: ResizeEntry[]) => {
    const [entry] = entries;
    if (entry && fit.current) {
      fit.current.fit();
    }
  };
  useEffect(() => {
    if (!wrapRef.current) {
      return;
    }
    if (!viewRef.current) {
      viewRef.current = wrapRef.current?.querySelector<HTMLDivElement>(".TerminalViewContent") ?? null;
    }
    if (!term.current) {
      const fitAddon = new FitAddon();
      const webglAddon = new FitAddon();
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
    }
    if (value) {
      term.current.write(value as any);
    }
    return () => {
      if (term.current) {
        term.current.dispose();
        term.current = null;
      }
    };
  }, [value]);

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
