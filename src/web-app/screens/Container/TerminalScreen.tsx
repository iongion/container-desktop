import { IconNames } from "@blueprintjs/icons";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { Terminal } from "@/web-app/components/Terminal";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./TerminalScreen.css";
import { useContainer } from "./queries";

export interface ScreenProps extends AppScreenProps {}

export const ID = "container.terminal";

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const containerQuery = useContainer(connectionId, decodeURIComponent(id || ""));
  const container = containerQuery.data;
  if (!container) {
    return <ScreenLoader screen={ID} pending={containerQuery.isLoading || containerQuery.isFetching} />;
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
  Path: "/screens/container/$id/terminal",
};
Screen.Metadata = {
  LeftIcon: IconNames.CALCULATOR,
  ExcludeFromSidebar: true,
};
