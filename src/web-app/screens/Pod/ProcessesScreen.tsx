import { HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PodProcessReport } from "@/container-client/types/pod";
import i18n from "@/i18n";
import { CopyButton } from "@/web-app/components/CopyButton";
import { ScreenLoader } from "@/web-app/components/ScreenLoader";
import { useRouteParams, useRouteSearch } from "@/web-app/Navigator";
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
  const { connId } = useRouteSearch<{ connId?: string }>();
  const primaryConnectionId = useAppStore((state) => state.currentConnector?.id || "");
  const connectionId = connId || primaryConnectionId;
  const podQuery = usePod(connectionId, id);
  const processesQuery = usePodProcesses(connectionId, id);
  const pod = podQuery.data;
  const pending = podQuery.isLoading || podQuery.isFetching || processesQuery.isLoading || processesQuery.isFetching;
  const onScreenReload = useCallback(() => {
    podQuery.refetch();
    processesQuery.refetch();
  }, [podQuery, processesQuery]);

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
      <ScreenHeader pod={pod} currentScreen={ID} onReload={onScreenReload} />
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
                          <CopyButton text={text} title={t("Copy to clipboard")} />
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
Screen.Title = i18n.t("Pod processes");
Screen.Route = {
  Path: "/screens/pod/$id/processes",
};
Screen.Metadata = {
  LeftIcon: IconNames.LIST_COLUMNS,
  ExcludeFromSidebar: true,
};
