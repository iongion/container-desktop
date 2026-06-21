import { Alignment, AnchorButton, Button, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Connector, ConnectorCapabilities } from "@/env/Types";
import { pathTo } from "@/web-app/Navigator";
import { visibleSidebarScreens } from "@/web-app/screenVisibility";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import type { AppScreen } from "@/web-app/Types";
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
  const availabilityConnector = useMemo(() => {
    const running = activeRuntime.filter((info) => info.running && info.capabilities);
    if (running.length <= 1) {
      return currentConnector;
    }
    const capabilities = running.reduce<ConnectorCapabilities>(
      (acc, info) => ({
        resources: {
          pods: acc.resources.pods || info.capabilities?.resources?.pods === true,
          secrets: acc.resources.secrets || info.capabilities?.resources?.secrets === true,
          networks: acc.resources.networks || info.capabilities?.resources?.networks === true,
        },
        events: acc.events || info.capabilities?.events === true,
        sort: { ...acc.sort, ...(info.capabilities?.sort ?? {}) },
        extensions: {
          machines: acc.extensions.machines || info.capabilities?.extensions?.machines === true,
          kube: acc.extensions.kube || info.capabilities?.extensions?.kube === true,
          contexts: acc.extensions.contexts || info.capabilities?.extensions?.contexts === true,
          swarm: acc.extensions.swarm || info.capabilities?.extensions?.swarm === true,
          builders: acc.extensions.builders || info.capabilities?.extensions?.builders === true,
          compose: acc.extensions.compose || info.capabilities?.extensions?.compose === true,
          registries: acc.extensions.registries || info.capabilities?.extensions?.registries === true,
          controllerVersion:
            acc.extensions.controllerVersion || info.capabilities?.extensions?.controllerVersion === true,
        },
      }),
      {
        resources: { pods: false, secrets: false, networks: false },
        events: false,
        sort: {},
        extensions: {
          machines: false,
          kube: false,
          contexts: false,
          swarm: false,
          builders: false,
          compose: false,
          registries: false,
          controllerVersion: false,
        },
      },
    );
    return { ...(currentConnector ?? ({} as Connector)), capabilities } as Connector;
  }, [activeRuntime, currentConnector]);
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
                title={isDisabled ? t("This feature is not available for current host") : undefined}
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
