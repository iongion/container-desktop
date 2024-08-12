import { Button, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { ScreenHeader } from ".";
import { AppScreen, AppScreenProps } from "../../Types";
import { Pod, PodProcessReport } from "../../Types.container-app";
import { ScreenLoader } from "../../components/ScreenLoader";

import { Notification } from "../../Notification";
import { useStoreActions } from "../../domain/types";

import { usePoller } from "../../Hooks";
import "./ProcessesScreen.css";

export const ID = "pod.processes";

interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(true);
  const [pod, setPod] = useState<Pod>();
  const { id } = useParams<{ id: string }>();
  const screenRef = useRef<HTMLDivElement>(null);
  const podFetch = useStoreActions((actions) => actions.pod.podFetch);
  const podFetchProcesses = useStoreActions((actions) => actions.pod.podFetchProcesses);

  const onCopyToClipboardClick = useCallback(
    async (e) => {
      const code = e.currentTarget.parentNode.querySelector("code");
      await navigator.clipboard.writeText(code.innerText);
      Notification.show({ message: t("The command was copied to clipboard"), intent: Intent.SUCCESS });
    },
    [t]
  );

  useEffect(() => {
    (async () => {
      try {
        setPending(true);
        const pod = await podFetch({
          Id: id as any
        });
        setPod(pod);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    })();
  }, [id, podFetch]);

  const screenUpdater = useMemo(() => {
    return async () => {
      if (!pod) {
        return;
      }
      try {
        setPending(true);
        await podFetchProcesses(pod);
      } catch (error: any) {
        console.error("Unable to fetch at this moment", error);
      } finally {
        setPending(false);
      }
    };
  }, [pod, podFetchProcesses]);

  // Change hydration
  usePoller({ poller: screenUpdater });

  const processes = useMemo(() => {
    let report: PodProcessReport = { Processes: [], Titles: [] };
    if (pod) {
      report = pod.Processes;
    }
    return report;
  }, [pod]);

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
    <div className="AppScreen" data-screen={ID} data-pending={pending ? "yes" : "no"} ref={screenRef}>
      {contents}
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Pod processes";
Screen.Route = {
  Path: `/screens/pod/:id/processes`
};
Screen.Metadata = {
  LeftIcon: IconNames.LIST_COLUMNS,
  ExcludeFromSidebar: true
};
