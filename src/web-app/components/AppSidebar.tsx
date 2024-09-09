import { Alignment, AnchorButton, ButtonGroup } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import { pathTo } from "@/web-app/Navigator";
import { AppScreen } from "@/web-app/Types";
import { useStoreState } from "@/web-app/domain/types";
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
  const currentConnector = useStoreState((state) => state.currentConnector);
  const expandSidebar = useStoreState((state) => state.userSettings.expandSidebar);
  const sidebarScreens = screens.filter((screen) => !screen.Metadata?.ExcludeFromSidebar);
  return (
    <div
      className="AppSidebar"
      data-expanded={expandSidebar ? "yes" : "no"}
      data-disabled={disabled ? "yes" : "no"}
      title={disabled ? t("To use these features a connection must be established") : ""}
    >
      <div className="AppSidebarActions">
        <ButtonGroup vertical>
          {sidebarScreens.map((Screen) => {
            const isDisabled = Screen.isAvailable ? !Screen.isAvailable(currentConnector) : false;
            return (
              <AnchorButton
                disabled={disabled || isDisabled}
                title={isDisabled ? t("This feature is not available for current host") : undefined}
                active={currentScreen?.ID === Screen.ID}
                href={pathTo(Screen.Route.Path)}
                text={t(Screen.Title)}
                alignText={Alignment.LEFT}
                minimal
                key={Screen.ID}
                data-screen={Screen.ID}
                icon={Screen.Metadata?.LeftIcon}
                rightIcon={Screen.Metadata?.RightIcon}
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
