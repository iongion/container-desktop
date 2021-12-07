import { useEffect, useRef, useState } from "react";
import { AnchorButton, Button, InputGroup, Icon, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";

import ClipboardJS from "clipboard";

import { useTranslation } from "react-i18next";

import { AppScreen } from "../../Types";
import { useStoreActions, useStoreState } from "../../App.store";
import { usePoller } from "../../Hooks";
import { Notification } from "../../Notification";

import { CONTAINER_DOCS_URL, CONTAINER_DOCS_EXAMPLE_CODE } from "../../Environment";

import "./Dashboard.css";

interface ScreenProps {}

export const ID = "dashboard";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const clipboardRef = useRef<ClipboardJS>();
  const containersFetch = useStoreActions((actions) => actions.containersFetch);
  const containersCount = useStoreState((state) => state.containers.length);
  const clipboardButtonRef = useRef<Button>(null);
  const [count, setCount] = useState(containersCount);
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
  useEffect(() => {
    setCount(containersCount);
  }, [containersCount]);

  // Change hydration
  usePoller({ poller: containersFetch });

  console.debug("Screen is rendering");

  return (
    <div className="AppScreen" data-screen={ID}>
      <div className="AppScreenContent">
        <NonIdealState
          icon={<Icon icon={IconNames.CUBE} size={120} />}
          title={t("containersCount", { count, context: `${count}` })}
          description={
            <div className="AppScreenContentViewport">
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
Screen.Title = "Dashboard";
Screen.Route = {
  Path: "/"
};
Screen.Metadata = {
  LeftIcon: IconNames.DASHBOARD
};
