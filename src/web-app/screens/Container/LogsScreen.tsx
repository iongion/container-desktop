import { IconNames } from "@blueprintjs/icons";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { Container } from "@/env/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { Terminal } from "@/web-app/components/Terminal";
import { useStoreActions } from "@/web-app/domain/types";
import { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./LogsScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.logs";

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
          withLogs: true
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
        <Terminal value={container.Logs} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Logs";
Screen.Route = {
  Path: `/screens/container/:id/logs`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true
};
