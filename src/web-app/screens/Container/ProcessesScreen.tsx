import { Button, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AppLabel } from "@/web-app/components/AppLabel";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";

import "./ProcessesScreen.css";
import { useContainer, useContainerProcesses } from "./queries";

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
  const onCopyToClipboardClick = useCallback(
    async (e) => {
      const contentNode = e.currentTarget?.parentNode.closest("td");
      await navigator.clipboard.writeText(contentNode?.getAttribute("data-command") || "");
      Notification.show({
        message: t("The command was copied to clipboard"),
        intent: Intent.SUCCESS,
      });
    },
    [t],
  );

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader container={container} currentScreen={ID} onReload={onScreenReload} />
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
                          <td key={processColumnKey} data-column={processColumn} data-command={columnValue}>
                            <Button
                              onClick={onCopyToClipboardClick}
                              variant="minimal"
                              size="small"
                              title={t("{{command}} (click to copy to clipboard)", { command: columnValue })}
                              icon={IconNames.CLIPBOARD}
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
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Container Processes";
Screen.Route = {
  Path: "/screens/container/$id/processes",
};
Screen.Metadata = {
  LeftIcon: IconNames.PANEL_TABLE,
  ExcludeFromSidebar: true,
};
