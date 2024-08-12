import { useEffect, useRef } from "react";
import { ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { Terminal as XTermTerminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

import "xterm/css/xterm.css";

import "./Terminal.css";

export interface TerminalProps {
  value?: string | Uint8Array;
}

export const Terminal: React.FC<TerminalProps> = ({ value }) => {
  const ref = useRef<HTMLDivElement>(null);
  const term = useRef<XTermTerminal>();
  const fit = useRef<FitAddon>();
  const handleResize = (entries: ResizeEntry[]) => {
    const [entry] = entries;
    if (entry && fit.current) {
      fit.current.fit();
    }
  };
  useEffect(() => {
    if (ref.current) {
      if (!term.current) {
        const fitAddon = new FitAddon();
        const terminal = new XTermTerminal({
          convertEol: true,
          // fontFamily: `monospace`,
          fontSize: 11,
          disableStdin: true,
          scrollback: 16 * 1024
          // logLevel: "debug",
          // rendererType: "canvas",
        });
        terminal.loadAddon(fitAddon);
        terminal.open(ref.current);
        fitAddon.fit();
        terminal.focus();
        term.current = terminal;
        fit.current = fitAddon;
      }
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
      <div className="TerminalViewContentWrap">
        <ResizeSensor onResize={handleResize}>
          <div className="TerminalViewContent" ref={ref}></div>
        </ResizeSensor>
      </div>
    </div>
  );
};
