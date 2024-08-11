import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

// project
import { AppScreen, AppScreenProps } from "../../Types";
import { Container } from "../../Types.container-app";
import { ScreenLoader } from "../../components/ScreenLoader";
import { Terminal } from "../../components/Terminal";
import { useStoreActions } from "../../domain/types";

// module
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
          Id: id as any,
          withStats: true
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
  Path: `/screens/container/:id/terminal`
};
Screen.Metadata = {
  LeftIcon: IconNames.CALCULATOR,
  ExcludeFromSidebar: true
};
