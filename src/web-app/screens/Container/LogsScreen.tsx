import { Callout, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { isContainerRunning } from "@/container-client/adapters/containers";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { Terminal } from "@/web-app/components/Terminal";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./LogsScreen.css";
import { useContainer, useContainerLogs } from "./queries";
import { useContainerLogStream } from "./useContainerLogStream";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.logs";

export const Screen: AppScreen<ScreenProps> = () => {
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId, undefined, { live: false });
  const container = containerQuery.data;
  const running = isContainerRunning(container);
  const logsQuery = useContainerLogs(connectionId, decodedId, { enabled: !!container && !running });
  const stream = useContainerLogStream(connectionId, decodedId, !!container && running);
  const pending = containerQuery.isLoading || (!container && containerQuery.isFetching);
  const onScreenReload = useCallback(() => {
    containerQuery.refetch();
    if (running) {
      stream.reload();
    } else {
      logsQuery.refetch();
    }
  }, [containerQuery, logsQuery, running, stream]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <div className="AppScreenContent">
        <div className="ContainerLogsStatus">
          <Tag minimal icon={running ? IconNames.PULSE : IconNames.STOP} intent={running ? "success" : "none"}>
            {running ? `Live logs: ${stream.status}` : "Stopped container: snapshot logs"}
          </Tag>
        </div>
        {stream.error ? <Callout intent="warning">Live log stream failed: {stream.error}</Callout> : null}
        {running ? (
          <Terminal writeMode="append" onReady={stream.setTerminal} />
        ) : (
          <Terminal value={logsQuery.data || container.Logs} writeMode="replace" />
        )}
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
