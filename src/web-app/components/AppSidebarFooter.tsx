import {
  Alignment,
  AnchorButton,
  Button,
  ButtonGroup,
  Intent,
  Navbar,
  NavbarGroup,
  NavbarHeading,
  Spinner,
  SpinnerSize,
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { AppTheme } from "@/web-app/App.types";
import { PROJECT_VERSION } from "@/web-app/Environment";
import { pathTo } from "@/web-app/Navigator";
import { useAppStore } from "@/web-app/stores/appStore";

import "./AppSidebarFooter.css";

export function AppSidebarFooter() {
  const { t } = useTranslation();
  const pending = useAppStore((state) => state.pending);
  const currentConnector = useAppStore((state) => state.currentConnector);
  const theme = useAppStore((state) => state.userSettings.theme);
  const expandSidebar = useAppStore((state) => state.userSettings.expandSidebar);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const onThemeToggleClick = useCallback(
    (e) => {
      setGlobalUserSettings({
        theme: theme === AppTheme.DARK ? AppTheme.LIGHT : AppTheme.DARK,
      });
    },
    [theme, setGlobalUserSettings],
  );
  const onExpandCollapseSidebarClick = useCallback(
    (e) => {
      setGlobalUserSettings({ expandSidebar: !expandSidebar });
    },
    [expandSidebar, setGlobalUserSettings],
  );
  const controller = currentConnector?.settings?.controller;
  const program = currentConnector?.settings?.program;
  const programInfo = {
    name: program?.name || "",
    version: "",
  };
  let programTitle = "";
  if (currentConnector?.capabilities?.extensions.controllerVersion) {
    programInfo.version = controller?.version || "";
    programTitle = t("Machine program version: {{version}}", program);
  } else {
    programInfo.version = program?.version || "";
  }
  const versionString = `v${PROJECT_VERSION}`;
  const programString = programInfo.version ? `${programInfo.name} ${programInfo.version}` : "";
  // Settings cog → user settings (mirrors the titlebar's cog); replaces the old version-info popover button.
  const rightContent = pending ? (
    <div className="AppSidebarFooterPendingIndicator">
      <Spinner intent={Intent.PRIMARY} size={SpinnerSize.SMALL} />
    </div>
  ) : (
    <AnchorButton
      className="AppSidebarSettingsButton"
      variant="minimal"
      icon={IconNames.COG}
      href={pathTo("/screens/settings/user-settings")}
      title={t("Settings")}
      aria-label={t("Settings")}
    />
  );
  return (
    <div className="AppSidebarFooter">
      <div className="AppSidebarFooterOverlay">
        <ButtonGroup variant="minimal">
          <Button
            icon={theme === AppTheme.DARK ? IconNames.MOON : IconNames.FLASH}
            onClick={onThemeToggleClick}
            title={t("Toggle {{mode}} mode", {
              mode: theme === AppTheme.DARK ? t("light") : t("dark"),
            })}
          />
          <Button
            icon={expandSidebar ? IconNames.DOUBLE_CHEVRON_LEFT : IconNames.DOUBLE_CHEVRON_RIGHT}
            onClick={onExpandCollapseSidebarClick}
            title={t("{{action}} the sidebar", {
              action: expandSidebar ? t("Collapse") : t("Expand"),
            })}
          />
        </ButtonGroup>
      </div>
      <Navbar className="AppSidebarFooterNavbar">
        <NavbarGroup align={Alignment.START} className="AppSidebarFooterVersions">
          <NavbarHeading>
            <strong>GUI</strong> <span className="AppSidebarVersionString">{versionString}</span>
            {programString ? (
              <>
                <strong>CLI</strong>{" "}
                <span className="AppSidebarProgramString" title={programTitle}>
                  {programString || "current"}
                </span>
              </>
            ) : null}
          </NavbarHeading>
        </NavbarGroup>
        <NavbarGroup align={Alignment.END} className="AppSidebarFooterRightColumn">
          {rightContent}
        </NavbarGroup>
      </Navbar>
    </div>
  );
}
