import { Button, Code, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import type { Container } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useStoreActions } from "@/web-app/domain/types";
import { Notification } from "@/web-app/Notification";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { ScreenHeader } from ".";

import "./ProcessesScreen.css";

interface ScreenProps extends AppScreenProps {}

export const ID = "container.processes";

export const Screen: AppScreen<ScreenProps> = () => {
  const [pending, setPending] = useState(true);
  const [container, setContainer] = useState<Container>();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const processesMap: any = container?.Processes || {
    Processes: [],
    Titles: [],
  };
  const processesList = processesMap.Processes || [];
  const processesTitles = processesMap.Titles || [];
  const containerFetch = useStoreActions((actions) => actions.container.containerFetch);
  const onScreenReload = useCallback(async () => {
    try {
      setPending(true);
      const container = await containerFetch({
        Id: decodeURIComponent(id as any),
        withStats: false,
        withProcesses: true,
      });
      setContainer(container);
    } catch (error: any) {
      console.error("Unable to fetch at this moment", error);
    } finally {
      setPending(false);
    }
  }, [containerFetch, id]);
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

  useEffect(() => {
    onScreenReload();
  }, [onScreenReload]);

  if (!container) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const isRunning = container?.State === "running" || (container as any).State.Status === "running";

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
                              minimal
                              small
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
  Path: "/screens/container/:id/processes",
};
Screen.Metadata = {
  LeftIcon: IconNames.PANEL_TABLE,
  ExcludeFromSidebar: true,
};
