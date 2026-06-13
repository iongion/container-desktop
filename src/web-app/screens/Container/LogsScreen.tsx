import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { Terminal } from "@/web-app/components/Terminal";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./LogsScreen.css";
import { useContainer, useContainerLogs } from "./queries";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.logs";

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const logsQuery = useContainerLogs(connectionId, decodedId);
  const container = containerQuery.data;
  const pending = containerQuery.isLoading || containerQuery.isFetching || logsQuery.isLoading || logsQuery.isFetching;
  const onScreenReload = useCallback(() => {
    containerQuery.refetch();
    logsQuery.refetch();
  }, [containerQuery, logsQuery]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <div className="AppScreenContent">
        <Terminal value={logsQuery.data || container.Logs} />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Logs";
Screen.Route = {
  Path: "/screens/container/$id/logs",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
