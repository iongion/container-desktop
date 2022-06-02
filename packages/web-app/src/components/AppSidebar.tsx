import { ButtonGroup, Alignment, AnchorButton } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import { AppSidebarFooter } from "./AppSidebarFooter";

import { AppScreen } from "../Types";
import { pathTo } from "../Navigator";
import { useStoreState } from "../domain/types";

// locals
import "./AppSidebar.css";

interface AppSidebarProps {
  screens: AppScreen<any>[];
  currentScreen: AppScreen<any>;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({ screens, currentScreen }) => {
  const { t } = useTranslation();
  const descriptor = useStoreState((state) => state.descriptor);
  const sidebarScreens = screens.filter((screen) => !screen.Metadata?.ExcludeFromSidebar);
  return (
    <div className="AppSidebar" data-expanded={descriptor.userSettings.expandSidebar ? "yes" : "no"}>
      <div className="AppSidebarActions">
        <ButtonGroup vertical>
          {sidebarScreens.map((Screen) => {
            const isDisabled = Screen.isAvailable ? !Screen.isAvailable(descriptor) : false;
            return (
              <AnchorButton
                disabled={isDisabled}
                title={isDisabled ? t("This feature is not available for current engine") : undefined}
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
