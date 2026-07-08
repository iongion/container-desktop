import { Alignment, AnchorButton, Button, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { pathTo } from "@/web-app/Navigator";
import { visibleSidebarScreens } from "@/web-app/screenVisibility";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen } from "@/web-app/Types";
import { resolveAvailabilityConnector } from "./AppSidebar.logic";
import { AppSidebarFooter } from "./AppSidebarFooter";

// locals
import "./AppSidebar.css";

interface AppSidebarProps {
  disabled?: boolean;
  screens: AppScreen<any>[];
  currentScreen: AppScreen<any>;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ disabled, screens, currentScreen }: AppSidebarProps) => {
  const { t } = useTranslation();
  const currentConnector = useAppStore((state) => state.currentConnector);
  const activeRuntime = useResourceStore((state) => state.activeRuntime);
  const expandSidebar = useAppStore((state) => state.userSettings.expandSidebar);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const sidebarScreens = visibleSidebarScreens(screens);
  // Capabilities reflect the UNION of running connections (always-merged workspace), not a single connector.
  const availabilityConnector = useMemo(
    () => resolveAvailabilityConnector(activeRuntime, currentConnector),
    [activeRuntime, currentConnector],
  );
  const onExpandCollapseSidebarClick = useCallback(() => {
    setGlobalUserSettings({ expandSidebar: !expandSidebar });
  }, [expandSidebar, setGlobalUserSettings]);

  return (
    <div
      className="AppSidebar"
      data-expanded={expandSidebar ? "yes" : "no"}
      data-disabled={disabled ? "yes" : "no"}
      title={disabled ? t("To use these features a connection must be established") : ""}
    >
      <Button
        className="AppSidebarExpandButton"
        variant="minimal"
        icon={expandSidebar ? IconNames.DOUBLE_CHEVRON_LEFT : IconNames.DOUBLE_CHEVRON_RIGHT}
        onClick={onExpandCollapseSidebarClick}
        title={t("{{action}} the sidebar", {
          action: expandSidebar ? t("Collapse") : t("Expand"),
        })}
        aria-label={t("{{action}} the sidebar", {
          action: expandSidebar ? t("Collapse") : t("Expand"),
        })}
      />
      <div className="AppSidebarActions">
        <ButtonGroup vertical>
          {sidebarScreens.map((Screen) => {
            const isDisabled = Screen.isAvailable ? !Screen.isAvailable(availabilityConnector) : false;
            return (
              <AnchorButton
                disabled={disabled || isDisabled}
                title={
                  isDisabled
                    ? t("This feature is not available for current host")
                    : Screen.Metadata?.Tooltip
                      ? t(Screen.Metadata.Tooltip)
                      : undefined
                }
                active={currentScreen?.ID === Screen.ID}
                href={pathTo(Screen.Route.Path)}
                text={t(Screen.Title)}
                alignText={Alignment.START}
                variant="minimal"
                key={Screen.ID}
                data-screen={Screen.ID}
                icon={Screen.Metadata?.LeftIcon}
                endIcon={Screen.Metadata?.RightIcon}
              />
            );
          })}
        </ButtonGroup>
      </div>
      <div className="AppSidebarContent"></div>
      <AppSidebarFooter />
    </div>
  );
};
