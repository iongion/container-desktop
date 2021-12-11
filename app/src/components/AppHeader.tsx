import { useCallback } from "react";
import { AnchorButton, Navbar, NavbarGroup, ButtonGroup, Divider, Button } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiBug, mdiWindowMinimize, mdiWindowMaximize, mdiWindowClose } from "@mdi/js";

import { AppScreen, Program } from "../Types";
import { CURRENT_ENVIRONMENT, PROJECT_NAME, PROJECT_VERSION } from "../Environment";
import { Native, WindowAction } from "../Native";
import { pathTo } from "../Navigator";

import "./AppHeader.css";
interface AppHeaderProps {
  screens: AppScreen<any>[];
  currentScreen?: AppScreen<any>;
  program?: Program;
  running?: boolean;
}

const WINDOW_ACTIONS_MAP = {
  "window.minimize": () => Native.getInstance().minimize(),
  "window.maximize": () => Native.getInstance().maximize(),
  "window.restore": () => Native.getInstance().restore(),
  "window.close": () => Native.getInstance().close()
};

export const AppHeader: React.FC<AppHeaderProps> = ({ currentScreen, program, running }) => {
  const { t } = useTranslation();
  const withControls = Native.getInstance().withWindowControls();
  const onWindowControlClick = useCallback((e) => {
    const action: WindowAction = e.currentTarget.getAttribute("data-action");
    const handler = WINDOW_ACTIONS_MAP[action];
    if (handler) {
      handler();
    } else {
      console.error("No handler for window action", action);
    }
  }, []);
  let rightSideControls;
  if (withControls) {
    const WINDOW_ACTIONS: {
      action: WindowAction;
      icon: any;
      title: string;
    }[] = [
      {
        action: WindowAction.Minimize,
        icon: <ReactIcon.Icon path={mdiWindowMinimize} size={0.75} />,
        title: t("Minimize")
      },
      {
        action: WindowAction.Maximize,
        icon: <ReactIcon.Icon path={mdiWindowMaximize} size={0.75} />,
        title: t("Maximize")
      },
      {
        action: WindowAction.Close,
        icon: <ReactIcon.Icon path={mdiWindowClose} size={0.75} />,
        title: t("Close")
      }
    ];
    rightSideControls = (
      <>
        <Divider />
        {WINDOW_ACTIONS.map((it) => {
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
        })}
      </>
    );
  }

  const provisioned = program && program.path;
  const rightSideActions =
    provisioned && running ? (
      <>
        <AnchorButton href={pathTo("/screens/settings")} icon={IconNames.COG} />
        <AnchorButton href={pathTo("/screens/troubleshoot")} icon={<ReactIcon.Icon path={mdiBug} size={0.75} />} />
      </>
    ) : null;
  const screenTitle = provisioned ? currentScreen?.Title : t("Your attention is needed");
  return (
    <div className="AppHeader" id="AppHeader">
      <Navbar>
        <NavbarGroup>
          <div className="App-companyLogoBrand">&nbsp;</div>
        </NavbarGroup>
        <NavbarGroup
          className="App-projectNameVersion"
          title={t("{{project}} {{version}} - Using {{env}} environment", {
            env: CURRENT_ENVIRONMENT,
            project: PROJECT_NAME,
            version: PROJECT_VERSION
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
