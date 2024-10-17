import { AnchorButton, Button, ButtonGroup, Divider, Navbar, NavbarGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiBug, mdiWindowClose, mdiWindowMaximize, mdiWindowMinimize } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { OperatingSystem, type Program, WindowAction } from "@/env/Types";
import { CURRENT_ENVIRONMENT, PROJECT_NAME, PROJECT_VERSION } from "../Environment";
import { pathTo } from "../Navigator";
import type { AppScreen } from "../Types";

import "./AppHeader.css";
interface AppHeaderProps {
  osType: OperatingSystem;
  screens: AppScreen<any>[];
  currentScreen?: AppScreen<any>;
  program?: Program;
  provisioned?: boolean;
  running?: boolean;
}

const WINDOW_ACTIONS_MAP = {
  "window.minimize": async () => {
    const instance = Application.getInstance();
    await instance.minimize();
  },
  "window.maximize": async () => {
    const instance = Application.getInstance();
    await instance.maximize();
  },
  "window.restore": async () => {
    const instance = Application.getInstance();
    await instance.restore();
  },
  "window.close": async () => {
    const instance = Application.getInstance();
    await instance.close();
  },
};

export const AppHeader: React.FC<AppHeaderProps> = ({
  osType,
  currentScreen,
  program,
  running,
  provisioned,
}: AppHeaderProps) => {
  const { t } = useTranslation();
  const [withControls, setWithControls] = useState(true);
  const onWindowControlClick = useCallback((e) => {
    const action: WindowAction = e.currentTarget.getAttribute("data-action");
    const handler = WINDOW_ACTIONS_MAP[action];
    if (handler) {
      handler();
    } else {
      console.error("No handler for window action", action);
    }
  }, []);

  let rightSideControls: React.ReactNode | null = null;
  if (withControls) {
    const WINDOW_ACTIONS: {
      action: WindowAction;
      icon: any;
      title: string;
    }[] = [
      {
        action: WindowAction.Minimize,
        icon: <ReactIcon.Icon path={mdiWindowMinimize} size={0.75} />,
        title: t("Minimize"),
      },
      {
        action: WindowAction.Maximize,
        icon: <ReactIcon.Icon path={mdiWindowMaximize} size={0.75} />,
        title: t("Maximize"),
      },
      {
        action: WindowAction.Close,
        icon: <ReactIcon.Icon path={mdiWindowClose} size={0.75} />,
        title: t("Close"),
      },
    ];
    rightSideControls = WINDOW_ACTIONS.map((it) => {
      return (
        <Button
          title={it.title}
          key={it.action}
          data-action={it.action}
          minimal
          icon={it.icon as any}
          onClick={onWindowControlClick}
        />
      );
    });
  }

  const rightSideActions =
    provisioned && running ? (
      <>
        <AnchorButton href={pathTo("/screens/settings/user-settings")} icon={IconNames.COG} />
        <AnchorButton
          href={pathTo("/screens/troubleshoot")}
          icon={<ReactIcon.Icon className="ReactIcon" path={mdiBug} size={0.75} />}
        />
        {osType === OperatingSystem.MacOS ? null : <Divider />}
      </>
    ) : null;
  const screenTitle = provisioned ? currentScreen?.Title : t("Your attention is needed");

  useEffect(() => {
    (async () => {
      const instance = Application.getInstance();
      const withControls = await instance.withWindowControls();
      setWithControls(withControls);
    })();
  }, []);

  return (
    <div className="AppHeader" id="AppHeader">
      <Navbar>
        <NavbarGroup className="App-projectBrand">
          <div className="App-companyLogoBrand">&nbsp;</div>
        </NavbarGroup>
        <NavbarGroup
          className="App-projectNameVersion"
          title={t("{{project}} {{version}} - Using {{env}} environment", {
            env: CURRENT_ENVIRONMENT,
            project: PROJECT_NAME,
            version: PROJECT_VERSION,
          })}
        >
          <span>{screenTitle}</span>
        </NavbarGroup>
        <NavbarGroup>
          <ButtonGroup minimal className="AppHeaderActions">
            {rightSideActions}
            {rightSideControls}
          </ButtonGroup>
        </NavbarGroup>
      </Navbar>
    </div>
  );
};
