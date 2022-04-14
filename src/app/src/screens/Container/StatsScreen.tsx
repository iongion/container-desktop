import { useEffect, useState } from "react";
import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

// project
import { AppScreenProps, AppScreen, Container } from "../../Types";
import { ScreenLoader } from "../../components/ScreenLoader";
import { useStoreActions } from "../../domain/types";

// module
import { ScreenHeader } from ".";

import "./StatsScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.stats";

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const containerFetch = useStoreActions((actions) => actions.container.containerFetch);
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
  const cpu_usage = container.Stats?.cpu_stats?.cpu || 0;
  const mem_usage = container.Stats?.memory_stats?.usage || 0;
  const disk_io = 0;
  const net_io = 0;
  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} />
      <div className="AppScreenContent">
        <HTMLTable className="AppContainerStatsView">
          <tbody>
            <tr className="AppContainerStatsViewPortRow">
              <td className="AppContainerStatsViewPort" data-view="view.cpu">
                <div data-metric="value">{cpu_usage}</div>
                <div data-metric="label">{t("CPU Usage")}</div>
              </td>
              <td className="AppContainerStatsViewPort" data-view="view.memory">
                <div data-metric="value">{mem_usage}</div>
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
  Path: `/screens/container/:id/stats`
};
Screen.Metadata = {
  LeftIcon: IconNames.CUBE,
  ExcludeFromSidebar: true
};
