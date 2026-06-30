import {
  AnchorButton,
  Button,
  ButtonGroup,
  Divider,
  Menu,
  MenuItem,
  Navbar,
  NavbarGroup,
  PopoverNext,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiBug } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Application } from "@/container-client/Application";
import { OperatingSystem, type Program, type WindowAction } from "@/env/Types";
import { WINDOW_CONTROLS } from "@/web-app/chrome/appChrome";
import { aiNavScreens } from "@/web-app/screenVisibility";
import { CURRENT_ENVIRONMENT, PROJECT_NAME, PROJECT_VERSION } from "../Environment";
import { pathTo } from "../Navigator";
import type { AppScreen } from "../Types";
import { AppHeaderLogo } from "./AppHeaderLogo";

import "./AppHeader.css";
import { createLogger } from "@/logger";

const logger = createLogger("web.AppHeader");

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
  screens,
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
      logger.error("No handler for window action", action);
    }
  }, []);

  let rightSideControls: React.ReactNode | null = null;
  if (withControls) {
    // Glyphs + IPC channels come from the shared chrome source (appChrome.ts) — the same definitions the
    // static boot splash renders, so the live header and the pre-React boot controls never drift.
    rightSideControls = WINDOW_CONTROLS.map((it) => {
      return (
        <Button
          title={t(it.label)}
          key={it.action}
          data-action={it.action}
          variant="minimal"
          icon={(<ReactIcon.Icon path={it.mdiPath} size={0.75} />) as any}
          onClick={onWindowControlClick}
        />
      );
    });
  }

  // AI navigation lives here (not the sidebar): a split button — the main button opens the Assistant,
  // the caret opens a menu of every AI screen. AI is always on, so it is always present.
  const aiScreens = aiNavScreens(screens ?? []);
  const aiAssistant = aiScreens.find((s) => s.ID === "ai.assistant") ?? aiScreens[0];
  const aiActions =
    aiScreens.length > 0 && aiAssistant ? (
      <ButtonGroup variant="minimal" className="AppHeaderAIActions">
        <AnchorButton
          className="AppHeaderActionButton"
          href={pathTo(aiAssistant.Route.Path)}
          icon={IconNames.CHAT}
          title={t("AI Assistant")}
          aria-label={t("AI Assistant")}
        />
        <PopoverNext
          placement="bottom-end"
          content={
            <Menu>
              {aiScreens.map((s) => (
                <MenuItem key={s.ID} icon={s.Metadata?.LeftIcon as any} text={t(s.Title)} href={pathTo(s.Route.Path)} />
              ))}
            </Menu>
          }
        >
          <Button
            className="AppHeaderActionButton"
            icon={IconNames.CARET_DOWN}
            title={t("AI tools")}
            aria-label={t("AI tools")}
          />
        </PopoverNext>
      </ButtonGroup>
    ) : null;

  const disabledHeaderActions = !(provisioned && running);
  const utilityActions = (
    <ButtonGroup variant="minimal" className="AppHeaderUtilityActions">
      <AnchorButton
        className="AppHeaderActionButton"
        href={pathTo("/screens/connections/manage")}
        icon={IconNames.DATA_CONNECTION}
        title={t("Connections")}
        aria-label={t("Connections")}
      />
      <AnchorButton
        className="AppHeaderActionButton"
        disabled={disabledHeaderActions}
        href={pathTo("/screens/troubleshoot")}
        icon={<ReactIcon.Icon className="ReactIcon" path={mdiBug} size={0.75} />}
        title={t("Troubleshoot")}
        aria-label={t("Troubleshoot")}
      />
    </ButtonGroup>
  );
  const headerActionDivider = osType === OperatingSystem.MacOS ? null : <Divider />;
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
          <div className="App-companyLogoBrand">
            <AppHeaderLogo />
          </div>
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
          <div className="AppHeaderActions">
            {aiActions}
            {utilityActions}
            {headerActionDivider}
            {rightSideControls ? (
              <ButtonGroup variant="minimal" className="AppHeaderWindowActions">
                {rightSideControls}
              </ButtonGroup>
            ) : null}
          </div>
        </NavbarGroup>
      </Navbar>
    </div>
  );
};
