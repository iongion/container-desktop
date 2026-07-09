import { Callout } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { isContainerRunning } from "@/container-client/adapters/containers";
import { LiveLogBadge, type LogStatus } from "@/web-app/components/LiveLogBadge";
import { ResourceSectionRail } from "@/web-app/components/ResourceSectionRail";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { Terminal } from "@/web-app/components/Terminal";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import "./LogsScreen.css";
import i18n from "@/i18n";
import { containerSectionRailItems } from "./Navigation";
import { useContainer, useContainerLogs } from "./queries";
import { useContainerLogStream } from "./useContainerLogStream";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.logs";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const engine = useAppStore((state) => state.connections.find((c) => c.id === connectionId)?.engine);
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

  const badgeStatus: LogStatus = running ? (stream.status === "idle" ? "connecting" : stream.status) : "snapshot";

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <ResourceSectionRail
        items={containerSectionRailItems(container, connectionId, engine)}
        activeId={ID}
        dataScreen={ID}
      >
        <div className="AppScreenContent">
          {stream.error ? (
            <Callout intent="warning">{t("Live log stream failed: {{error}}", { error: stream.error })}</Callout>
          ) : null}
          {running ? (
            <Terminal writeMode="append" onReady={stream.setTerminal} overlay={<LiveLogBadge status={badgeStatus} />} />
          ) : (
            <Terminal
              value={logsQuery.data || container.Logs}
              writeMode="replace"
              overlay={<LiveLogBadge status="snapshot" />}
            />
          )}
        </div>
      </ResourceSectionRail>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Container Logs");
Screen.Route = {
  Path: "/screens/container/$id/logs",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
