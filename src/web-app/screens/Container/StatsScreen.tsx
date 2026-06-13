import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";

import "./StatsScreen.css";
import { useContainer, useContainerStats } from "./queries";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.stats";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const statsQuery = useContainerStats(connectionId, decodedId);
  const container = containerQuery.data;
  const stats = statsQuery.data || container?.Stats;
  const pending =
    containerQuery.isLoading || containerQuery.isFetching || statsQuery.isLoading || statsQuery.isFetching;
  const cpu_usage = stats?.cpu_stats?.cpu || 0;
  const mem_usage = stats?.memory_stats?.usage || 0;
  const disk_io = 0;
  const net_io = 0;
  const onScreenReload = useCallback(() => {
    containerQuery.refetch();
    statsQuery.refetch();
  }, [containerQuery, statsQuery]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <div className="AppScreenContent">
        <HTMLTable className="AppContainerStatsView">
          <tbody>
            <tr className="AppContainerStatsViewPortRow">
              <td className="AppContainerStatsViewPort" data-view="view.cpu">
                <div data-metric="value">{cpu_usage}</div>
                <div data-metric="label">{t("CPU Usage")}</div>
              </td>
              <td className="AppContainerStatsViewPort" data-view="view.memory">
                <div data-metric="value">{prettyBytes(mem_usage ?? 0)}</div>
                <div data-metric="label">{t("MEM Usage")}</div>
              </td>
            </tr>
            <tr className="AppContainerStatsViewPortRow">
              <td className="AppContainerStatsViewPort" data-view="view.disk">
                <div data-metric="value">{disk_io}</div>
                <div data-metric="label">{t("DSK I/O")}</div>
              </td>
              <td className="AppContainerStatsViewPort" data-view="view.network">
                <div data-metric="value">{net_io}</div>
                <div data-metric="label">{t("NET I/O")}</div>
              </td>
            </tr>
          </tbody>
        </HTMLTable>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Stats";
Screen.Route = {
  Path: "/screens/container/$id/stats",
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true,
};
