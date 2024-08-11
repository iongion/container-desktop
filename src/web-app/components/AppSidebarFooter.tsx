import {
  Alignment,
  Button,
  ButtonGroup,
  Intent,
  Navbar,
  NavbarGroup,
  NavbarHeading,
  Popover,
  PopoverInteractionKind,
  Spinner,
  SpinnerSize
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { AppTheme, useStoreActions, useStoreState } from "../domain/types";
import CurrentEnvironment, { PROJECT_VERSION } from "../Environment";
import { ContainerEngine } from "../Types.container-app";

import "./AppSidebarFooter.css";

export function AppSidebarFooter() {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const currentConnector = useStoreState((state) => state.descriptor.currentConnector);
  const theme = useStoreState((state) => state.descriptor.userSettings.theme);
  const expandSidebar = useStoreState((state) => state.descriptor.userSettings.expandSidebar);
  const setGlobalUserSettings = useStoreActions((actions) => actions.setGlobalUserSettings);
  const onThemeToggleClick = useCallback(
    (e) => {
      setGlobalUserSettings({ theme: theme === AppTheme.DARK ? AppTheme.LIGHT : AppTheme.DARK });
    },
    [theme, setGlobalUserSettings]
  );
  const onExpandCollapseSidebarClick = useCallback(
    (e) => {
      setGlobalUserSettings({ expandSidebar: !expandSidebar });
    },
    [expandSidebar, setGlobalUserSettings]
  );
  const controller = currentConnector.settings.current.controller;
  const program = currentConnector.settings.current.program;
  const programInfo = {
    name: program?.name || "",
    version: ""
  };
  let programTitle = "";
  if (currentConnector?.engine === ContainerEngine.PODMAN_VIRTUALIZED) {
    programInfo.version = controller?.version || "";
    programTitle = t("Machine program version: {{version}}", program);
  } else {
    programInfo.version = program?.version || "";
  }
  const versionString = `v${PROJECT_VERSION}.${CurrentEnvironment.name[0]}`;
  const programString = `${programInfo.name} ${programInfo.version}`;
  let rightContent = pending ? (
    <div className="AppSidebarFooterPendingIndicator">
      <Spinner intent={Intent.PRIMARY} size={SpinnerSize.SMALL} />
    </div>
  ) : null;
  if (!expandSidebar) {
    rightContent = (
      <Popover
        usePortal={false}
        inheritDarkTheme
        transitionDuration={0}
        interactionKind={PopoverInteractionKind.CLICK}
        popoverClassName="bp5-popover-content-sizing AppSidebarInfoPopover"
        position="top-left"
        content={
          <div className="AppSidebarFooterVersionsMenu">
            <span className="AppSidebarVersionString">
              <strong>GUI</strong> {versionString}
            </span>
            <br />
            <span className="AppSidebarProgramString" title={programTitle}>
              <strong>CLI</strong> {programString}
            </span>
          </div>
        }
      >
        <Button className="AppSidebarInfoButton" minimal icon={IconNames.INFO_SIGN} />
      </Popover>
    );
  }
  return (
    <div className="AppSidebarFooter">
      <div className="AppSidebarFooterOverlay">
        <ButtonGroup minimal>
          <Button
            icon={theme === AppTheme.DARK ? IconNames.MOON : IconNames.FLASH}
            onClick={onThemeToggleClick}
            title={t("Toggle {{mode}} mode", { mode: theme === AppTheme.DARK ? t("light") : t("dark") })}
          />
          <Button
            icon={expandSidebar ? IconNames.DOUBLE_CHEVRON_LEFT : IconNames.DOUBLE_CHEVRON_RIGHT}
            onClick={onExpandCollapseSidebarClick}
            title={t("{{action}} the sidebar", { action: expandSidebar ? t("Collapse") : t("Expand") })}
          />
        </ButtonGroup>
      </div>
      <Navbar className="AppSidebarFooterNavbar">
        <NavbarGroup align={Alignment.LEFT} className="AppSidebarFooterVersions">
          <NavbarHeading>
            <strong>GUI</strong> <span className="AppSidebarVersionString">{versionString}</span>
            <strong>CLI</strong>{" "}
            <span className="AppSidebarProgramString" title={programTitle}>
              {programString}
            </span>
          </NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.RIGHT} className="AppSidebarFooterRightColumn">
          {rightContent}
        </NavbarGroup>
      </Navbar>
    </div>
  );
}
