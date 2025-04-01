import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "wouter";

import type { Container } from "@/env/Types";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { Terminal } from "@/web-app/components/Terminal";
import { useStoreActions } from "@/web-app/domain/types";

import { ScreenHeader } from ".";
import "./TerminalScreen.css";

export interface ScreenProps extends AppScreenProps {}

export const ID = "container.terminal";

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { id } = useParams<{ id: string }>();
  const containerFetch = useStoreActions((actions) => actions.container.containerFetch);
  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const container = await containerFetch({
          Id: decodeURIComponent(id as any),
          withStats: true,
        });
        setContainer(container);
      } catch (error: any) {
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
        <Terminal />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Terminal";
Screen.Route = {
  Path: "/screens/container/:id/terminal",
};
Screen.Metadata = {
  LeftIcon: IconNames.CALCULATOR,
  ExcludeFromSidebar: true,
};
