import { ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
// import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal as XTermTerminal } from "@xterm/xterm";

import { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

import "./Terminal.css";

export interface TerminalProps {
  value?: string | Uint8Array;
}

export const Terminal: React.FC<TerminalProps> = ({ value }: TerminalProps) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>();
  const term = useRef<XTermTerminal>();
  const fit = useRef<FitAddon>();
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
      viewRef.current = wrapRef.current.querySelector<HTMLDivElement>(".TerminalViewContent") ?? undefined;
    }
    if (!term.current) {
      const fitAddon = new FitAddon();
      const webglAddon = new FitAddon();
      // const unicode11Addon = new Unicode11Addon();
      const terminal = new XTermTerminal({
        convertEol: true,
        fontSize: 11,
        disableStdin: true,
        scrollback: 16 * 1024,
        logLevel: "error",
        allowProposedApi: true
      });
      terminal.loadAddon(fitAddon);
      // terminal.loadAddon(unicode11Addon);
      try {
        terminal.loadAddon(webglAddon);
      } catch (error: any) {
        console.error("Unable to activate web gl");
      }
      // terminal.unicode.activeVersion = "11";
      terminal.open(viewRef.current!);
      fitAddon.fit();
      terminal.focus();
      term.current = terminal;
      fit.current = fitAddon;
    }
    if (value) {
      term.current?.write(value);
    }
    return () => {
      if (term.current) {
        term.current.dispose();
        term.current = undefined;
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
