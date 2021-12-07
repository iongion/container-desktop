import { useEffect, useState, useRef } from "react";
import { IconNames } from "@blueprintjs/icons";
import { ResizeEntry, ResizeSensor } from "@blueprintjs/core";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { useParams } from "react-router-dom";

import { AppScreen, Container } from "../../Types";
import { ScreenHeader } from ".";
import { ScreenLoader } from "../ScreenLoader";

import { useStoreActions } from "./Model";

import "xterm/css/xterm.css";
import "./TerminalScreen.css";

export const TerminalView = () => {
  const ref = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal>();
  const fit = useRef<FitAddon>();
  const handleResize = (entries: ResizeEntry[]) => {
    const [entry] = entries;
    if (entry && fit.current) {
      // console.log(entries.map((e) => `${e.contentRect.width} x ${e.contentRect.height}`));
      fit.current.fit();
    }
  };
  useEffect(() => {
    if (ref.current) {
      const fitAddon = new FitAddon();
      const terminal = new Terminal();
      terminal.loadAddon(fitAddon);
      terminal.open(ref.current);
      fitAddon.fit();
      terminal.focus();
      term.current = terminal;
      fit.current = fitAddon;
    }
    return () => {
      if (term.current) {
        term.current.dispose();
        term.current = undefined;
      }
    };
  });
  return (
    <div className="TerminalView">
      <ResizeSensor onResize={handleResize}>
        <div className="TerminalViewContent" ref={ref}></div>
      </ResizeSensor>
    </div>
  );
};

interface ScreenProps {}

export const ID = "container.terminal";

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { id } = useParams<{ id: string }>();
  const containerFetch = useStoreActions((actions) => actions.containerFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const container = await containerFetch({
          Id: id,
          withStats: true
        });
        setContainer(container);
      } catch (error) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [containerFetch, id]);
  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} />
      <div className="AppScreenContent">
        <TerminalView />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Terminal";
Screen.Route = {
  Path: `/screens/container/:id/terminal`
};
Screen.Metadata = {
  LeftIcon: IconNames.CALCULATOR,
  ExcludeFromSidebar: true
};
