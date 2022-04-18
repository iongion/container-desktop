import { useEffect, useRef } from "react";
import { AnchorButton, Button, InputGroup, Icon, Intent, NonIdealState, H6, HTMLTable } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import ClipboardJS from "clipboard";
import { useTranslation } from "react-i18next";

// project
import { AppScreenProps, AppScreen } from "../../Types";
import { usePoller } from "../../Hooks";
import { Notification } from "../../Notification";
import { CONTAINER_DOCS_URL, CONTAINER_DOCS_EXAMPLE_CODE } from "../../Environment";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import "./Dashboard.css";

export const ID = "dashboard";
export const Title = "Dashboard";

export interface ScreenProps extends AppScreenProps {}

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const clipboardRef = useRef<ClipboardJS>();
  const containersFetchStats = useStoreActions((actions) => actions.dashboard.containersFetchStats);
  const containerStats = useStoreState((state) => state.dashboard.containerStats);
  const clipboardButtonRef = useRef<Button>(null);
  useEffect(() => {
    if (!clipboardButtonRef.current?.buttonRef) {
      return;
    }
    if (clipboardRef.current) {
      clipboardRef.current.destroy();
    }
    clipboardRef.current = new ClipboardJS(clipboardButtonRef.current.buttonRef, {
      text: (trigger: Element): string => {
        Notification.show({ message: t("The command was copied to clipboard"), intent: Intent.SUCCESS });
        return trigger.parentElement?.parentElement?.querySelector("input")?.value || "";
      }
    });
  }, [t]);

  // Change hydration
  usePoller({ poller: containersFetchStats });

  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="AppScreenContent">
        <NonIdealState
          icon={<Icon icon={IconNames.CUBE} size={120} />}
          title={t("containersRunning", { count: containerStats.running, context: `${containerStats.running}` })}
          description={
            <div className="AppScreenContentViewport">
              <HTMLTable className="DashboardContainersReportTable" striped condensed bordered>
                <tbody>
                  <tr>
                    <td>{t("Paused")}</td>
                    <td>{containerStats.paused}</td>
                  </tr>
                  <tr>
                    <td>{t("Exited")}</td>
                    <td>{containerStats.exited}</td>
                  </tr>
                </tbody>
              </HTMLTable>
              <p>{t("As an example, copy and paste this command into your terminal and then come back")}</p>
              <InputGroup
                className="DashboardContainerExampleCode"
                value={CONTAINER_DOCS_EXAMPLE_CODE}
                readOnly
                rightElement={<Button icon={IconNames.CLIPBOARD} ref={clipboardButtonRef} />}
              />
              <AnchorButton
                className="DashboardContainerDocsUrl"
                href={CONTAINER_DOCS_URL}
                target="_blank"
                minimal
                icon={IconNames.LINK}
                text={t("Explore more in the docs")}
                intent={Intent.PRIMARY}
              />
            </div>
          }
        />
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: "/"
};
Screen.Metadata = {
  LeftIcon: IconNames.DASHBOARD
};
