import { Code, HTMLTable, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { AppLabel } from "@/web-app/components/AppLabel";
import { CopyButton } from "@/web-app/components/CopyButton";
import { ResourceSectionRail } from "@/web-app/components/ResourceSectionRail";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";
import { containerSectionRailItems } from "./Navigation";
import { useContainer, useContainerProcesses } from "./queries";

import "./ProcessesScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.processes";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const decodedId = decodeURIComponent(id || "");
  const containerQuery = useContainer(connectionId, decodedId);
  const container = containerQuery.data;
  const isRunning = container?.State === "running" || (container as any)?.State?.Status === "running";
  const processesQuery = useContainerProcesses(connectionId, decodedId, !!isRunning);
  const processesMap: any = processesQuery.data || { Processes: [], Titles: [] };
  const processesList = processesMap.Processes || [];
  const processesTitles = processesMap.Titles || [];
  const pending =
    containerQuery.isLoading || containerQuery.isFetching || processesQuery.isLoading || processesQuery.isFetching;
  const onScreenReload = useCallback(() => {
    containerQuery.refetch();
    processesQuery.refetch();
  }, [containerQuery, processesQuery]);
  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
      <ResourceSectionRail items={containerSectionRailItems(container.Id, connectionId)} activeId={ID} dataScreen={ID}>
        <div className="AppScreenContent">
          {isRunning ? (
            <HTMLTable interactive compact striped className="AppDataTable" data-table="processes">
              <thead>
                <tr>
                  {processesTitles.map((title) => {
                    return (
                      <th key={title} data-column={title}>
                        <AppLabel text={title} />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {processesList.map((processColumns) => {
                  const pid = processColumns[1];
                  return (
                    <tr key={pid}>
                      {processColumns.map((columnValue, columnIndex) => {
                        const processColumn = processesTitles[columnIndex];
                        const processColumnKey = `${pid}-${processColumn}`;
                        if (processColumn.toLowerCase() === "command") {
                          return (
                            <td key={processColumnKey} data-column={processColumn}>
                              <CopyButton
                                text={columnValue}
                                title={t("{{command}} (click to copy to clipboard)", { command: columnValue })}
                              />
                            </td>
                          );
                        }
                        return (
                          <td key={processColumnKey} data-column={processColumn}>
                            <Code>{columnValue}</Code>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </HTMLTable>
          ) : (
            <NonIdealState
              icon={IconNames.PANEL_TABLE}
              title={t("No processes")}
              description={<p>{t("This container is not running")}</p>}
            />
          )}
        </div>
      </ResourceSectionRail>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = i18n.t("Container Processes");
Screen.Route = {
  Path: "/screens/container/$id/processes",
};
Screen.Metadata = {
  LeftIcon: IconNames.PANEL_TABLE,
  ExcludeFromSidebar: true,
};
