import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PodProcessReport } from "@/env/Types";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams } from "@/web-app/Navigator";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ScreenHeader } from ".";
import "./ProcessesScreen.css";
import { usePod, usePodProcesses } from "./queries";

export const ID = "pod.processes";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const { id } = useRouteParams<{ id: string }>();
  const connectionId = useAppStore((state) => state.currentConnector?.id || "");
  const podQuery = usePod(connectionId, id);
  const processesQuery = usePodProcesses(connectionId, id);
  const pod = podQuery.data;
  const pending = podQuery.isLoading || podQuery.isFetching || processesQuery.isLoading || processesQuery.isFetching;

  const onCopyToClipboardClick = useCallback(
    async (e) => {
      const code = e.currentTarget.parentNode.querySelector("code");
      await navigator.clipboard.writeText(code.innerText);
      Notification.show({
        message: t("The command was copied to clipboard"),
        intent: Intent.SUCCESS,
      });
    },
    [t],
  );

  const processes = useMemo(() => {
    let report: PodProcessReport = { Processes: [], Titles: [] };
    if (processesQuery.data) {
      report = processesQuery.data;
    } else if (pod) {
      report = pod.Processes;
    }
    return report;
  }, [pod, processesQuery.data]);

  if (!pod) {
    return <ScreenLoader screen={ID} pending={pending} />;
  }

  const contents = (
    <>
      <ScreenHeader pod={pod} currentScreen={ID} />
      <div className="AppScreenContent">
        <HTMLTable compact striped className="AppDataTable" data-table="pod.processes">
          <thead>
            <tr>
              {processes.Titles.map((title: string) => {
                return (
                  <th key={title} data-column={title}>
                    {title}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {processes.Processes.map((it, processIndex) => {
              // TODO: Compute checksum of entire object instead of using index if no key
              const rowKey = `process_${it[1]}_${processIndex}`;
              return (
                <tr key={rowKey}>
                  {processes.Titles.map((title, index) => {
                    const text = it[index] as string;
                    const contents =
                      title === "COMMAND" ? (
                        <div className="CommandColumn">
                          <code title={text}>{text}</code>
                          <Button
                            small
                            minimal
                            icon={IconNames.CLIPBOARD}
                            data-action="copy.to.clipboard"
                            title={t("Copy to clipboard")}
                            onClick={onCopyToClipboardClick}
                          />
                        </div>
                      ) : (
                        text
                      );
                    const colKey = `col_${rowKey}_${title}`;
                    return (
                      <td key={colKey} data-column={title}>
                        {contents}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </HTMLTable>
      </div>
    </>
  );

  return (
    <div className="AppScreen" data-screen={ID} data-pending={pending ? "yes" : "no"}>
      {contents}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod processes";
Screen.Route = {
  Path: "/screens/pod/$id/processes",
};
Screen.Metadata = {
  LeftIcon: IconNames.LIST_COLUMNS,
  ExcludeFromSidebar: true,
};
